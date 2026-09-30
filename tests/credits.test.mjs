/**
 * The credit rules now live in TypeScript as well as in a SQL trigger, and the
 * two have to agree exactly.
 *
 * They are the same rule written twice, and that is the whole risk. A credit
 * balance is what a parent reads and what badges cost, so a divergence is not a
 * rounding difference - it is a number nobody can explain. The trigger is the
 * older of the two and is still what the live system runs, so it is treated here
 * as the reference and the TypeScript is checked against it, answer by answer,
 * over a run long enough for the streak bonus to land in every position.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  awardFor,
  BASE_CREDITS,
  ELIGIBLE_ANSWERS,
  MASTERY_CREDITS,
  STREAK_BONUS,
  paid,
} from "../lib/challenge/credits.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  db.prepare(
    "INSERT INTO users(id,email,password,created_at) VALUES('u','t@example.test','x',0)",
  ).run();
  return db;
}

/**
 * One answered question, written the way the live path writes it, so the trigger
 * does the awarding. `eligible` is the cap the SQL applies in
 * lib/server/challenge.ts, reproduced here so the comparison is against the
 * trigger and not against that file.
 */
function answer(db, { correct = 1, revealed = 0, mastered = 0, before = 0 }) {
  const id = crypto.randomUUID();
  const eligible = correct === 1 && before < ELIGIBLE_ANSWERS ? 1 : 0;
  db.prepare(
    "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed) VALUES(?,'u','w','[]',1,'def','x','p',1,?,?,1)",
  ).run(id, revealed ? -1 : 0, correct);
  // The guard the answer path writes first: the event only exists when the word
  // had an unanswered attempt.
  db.prepare(
    "INSERT INTO progress(user_id,word_id,correct,seen,retry_at) VALUES('u','w',0,1,NULL) ON CONFLICT(user_id,word_id) DO NOTHING",
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered,evidence)
     SELECT ?, 'u','w',1,'2026-09-29',?,?,?,?,'x' FROM attempts WHERE id=? AND answered_at IS NOT NULL
       AND EXISTS(SELECT 1 FROM progress WHERE user_id='u' AND word_id='w' AND correct=0)`,
  ).run(id, correct, revealed, eligible, mastered, id);
  return db
    .prepare(
      "SELECT base_credits AS base, streak_credits AS streakBonus, mastery_credits AS mastery, streak AS streakAfter FROM learning_events WHERE attempt_id=?",
    )
    .get(id);
}

const wallet = (db) =>
  db
    .prepare(
      "SELECT balance,streak,best_streak AS best FROM credit_wallets WHERE user_id='u'",
    )
    .get() ?? { balance: 0, streak: 0, best: 0 };

test("the pure rules agree with the trigger, answer for answer", () => {
  const db = database();
  // A long enough run that the every-third bonus lands in each position, the cap
  // on eligibility comes into force, and a word is finished partway through.
  const run = [];
  for (let i = 0; i < 12; i++) {
    const before = db
      .prepare(
        "SELECT COUNT(*) AS c FROM learning_events WHERE user_id='u' AND word_id='w' AND eligible=1",
      )
      .get().c;
    const correct = i === 4 || i === 9 ? 0 : 1; // two wrong answers, to reset the streak
    const revealed = i === 7 ? 1 : 0;
    const mastered = i === 5 ? 1 : 0;
    const streakBefore = wallet(db).streak;
    const fromTrigger = answer(db, { correct, revealed, mastered, before });
    const mine = awardFor(
      {
        correct: correct === 1,
        eligible: correct === 1 && before < ELIGIBLE_ANSWERS,
        mastered: mastered === 1,
      },
      streakBefore,
    );
    assert.equal(
      mine.base,
      fromTrigger.base,
      `answer ${i}: base credits differ`,
    );
    assert.equal(
      mine.streak,
      fromTrigger.streakBonus,
      `answer ${i}: streak bonus differs`,
    );
    assert.equal(
      mine.mastery,
      fromTrigger.mastery,
      `answer ${i}: mastery credits differ`,
    );
    assert.equal(
      mine.streakAfter,
      fromTrigger.streakAfter,
      `answer ${i}: the running streak differs`,
    );
    assert.equal(
      mine.total,
      fromTrigger.base + fromTrigger.streakBonus + fromTrigger.mastery,
      `answer ${i}: the total differs`,
    );
    run.push({
      i,
      correct,
      revealed,
      before,
      total: mine.total,
      streak: mine.streakAfter,
    });
  }
  // The run has to have been worth running: the bonus must actually have fired,
  // the cap must have bitten, and a wrong answer must have cleared the streak.
  assert.ok(
    run.some((r) => r.streak > 0),
    "the fixture never paid a streak bonus, so the hardest rule was never compared",
  );
  assert.ok(
    run.some(
      (r) => r.correct === 1 && r.before >= ELIGIBLE_ANSWERS && r.total === 0,
    ),
    "the fixture never hit the eligibility cap",
  );
  assert.ok(
    run.some((r) => r.correct === 0 && r.streak === 0),
    "the fixture never had a wrong answer clear the streak",
  );
  db.close();
});

test("the constants are the ones the trigger uses", () => {
  // Read rather than restate, so a change to the SQL is a failing test rather
  // than a divergence nobody notices.
  const sql = readFileSync("drizzle/0003_ordinary_edwin_jarvis.sql", "utf8");
  assert.match(
    sql,
    /THEN 2 ELSE 0 END/,
    "the trigger must still pay 2 for a counted correct answer",
  );
  assert.match(sql, /THEN 5 ELSE 0 END/, "and 5 for the streak bonus");
  assert.match(sql, /THEN 10 ELSE 0 END/, "and 10 for finishing a word");
  assert.match(sql, /%3=0/, "and the bonus must still be every third");
  assert.equal(BASE_CREDITS, 2);
  assert.equal(STREAK_BONUS, 5);
  assert.equal(MASTERY_CREDITS, 10);
});

test("an assisted answer is right but pays nothing and does not break the streak", () => {
  // The divergence the review reproduced: the SQL keys eligibility off
  // `is_correct`, so an assisted answer is eligible, while the mastery counter
  // in TypeScript does not advance for one. These rules are written so the caller
  // decides eligibility explicitly, which is what makes the disagreement
  // impossible to express by accident.
  const streak = 2;
  const assisted = awardFor(
    { correct: true, eligible: true, mastered: false },
    streak,
  );
  assert.equal(assisted.base, BASE_CREDITS, "an eligible correct answer pays");
  assert.equal(assisted.streakAfter, streak + 1, "and advances the streak");

  // A right answer that is not eligible - a word past its cap, or an assisted one
  // the caller has marked uncounted - pays nothing and leaves the streak alone.
  const capped = awardFor(
    { correct: true, eligible: false, mastered: false },
    streak,
  );
  assert.equal(capped.total, 0, "a word past its cap must not pay again");
  assert.equal(
    capped.streakAfter,
    streak,
    "and must not advance or clear the streak",
  );
});

test("a wrong answer clears the streak without touching the balance", () => {
  const wrong = awardFor(
    { correct: false, eligible: false, mastered: false },
    7,
  );
  assert.equal(wrong.total, 0);
  assert.equal(wrong.streakAfter, 0, "a wrong answer clears the streak");
});

test("finishing a word pays the mastery bonus on top", () => {
  const award = awardFor({ correct: true, eligible: true, mastered: true }, 0);
  assert.equal(award.base, BASE_CREDITS);
  assert.equal(award.mastery, MASTERY_CREDITS);
  assert.equal(award.total, BASE_CREDITS + MASTERY_CREDITS);
  assert.equal(paid(award), true);
  assert.equal(
    paid(awardFor({ correct: false, eligible: false, mastered: false }, 0)),
    false,
  );
});
