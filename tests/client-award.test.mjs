/**
 * The browser now says what an answer is worth before the server has seen it.
 *
 * That is only safe because both sides run the same functions over the same
 * state. If they drift, a child watches their balance move to a number that turns
 * out to be wrong, and the correction at the next flush is not a rounding
 * difference - it is a balance a parent reads.
 *
 * So the engine's award is compared against the award the database would compute,
 * answer by answer, over a run long enough to cross the five-answer cap, the
 * every-third streak bonus and a word being finished.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { PracticeEngine } from "../lib/challenge/engine.ts";
import {
  BASE_CREDITS,
  ELIGIBLE_ANSWERS,
  MASTERY_CREDITS,
  STREAK_BONUS,
} from "../lib/challenge/credits.ts";
import { CUMULATIVE_FLOOR } from "../lib/challenge/mastery.ts";
import { QUESTION_TYPES } from "../lib/challenge/config.ts";

const manifest = JSON.parse(readFileSync("data/client-bank.json", "utf8"));
const bank = JSON.parse(readFileSync(`public${manifest.full.url}`, "utf8"));

function seeded(seed = 11) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
// A clock that moves. Frozen, every answer has an elapsed time of zero, which
// `classify` reads as "uncertain" - and an uncertain answer builds neither a run
// nor a recall, so the word could never be finished and the mastery award would
// never have been compared at all.
let clock = Date.parse("2026-09-29T12:00:00Z");
const now = () => clock;
const tick = (ms = 4000) => (clock += ms);

/**
 * Three words that all have a definition question.
 *
 * More than one because a word that reaches its target is retired, and the engine
 * then declines to offer it - correct behaviour, but it means a single-word
 * fixture runs out of questions a few answers in and the rest of the run is never
 * compared.
 */
const WORDS = [
  "abandon",
  "abundance",
  "affable",
  "antiquity",
  "arduous",
  "assiduous",
  "avowed",
  "barren",
];
function engineFor(overrides = {}) {
  return new PracticeEngine({
    bank,
    // Fed per answer from the database, because a fresh engine is a page load and
    // a page load has the server's progress, not an empty one.
    progress: overrides.progress ?? [],
    typeCounts: [],
    attemptCount: 0,
    recent: [],
    addedWords: [],
    excluded: [],
    allowedWordIds: new Set(WORDS),
    level: null,
    types: [...QUESTION_TYPES],
    random: seeded(),
    now,
    ...overrides,
  });
}

test("the engine's award matches what the database would pay", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  db.prepare(
    "INSERT INTO users(id,email,password,created_at) VALUES('agree','a@example.test','x',0)",
  ).run();
  const wallet = () =>
    db
      .prepare(
        "SELECT balance,streak FROM credit_wallets WHERE user_id='agree'",
      )
      .get() ?? {
      balance: 0,
      streak: 0,
    };
  const eligibleFromDb = () =>
    db
      .prepare(
        "SELECT word_id,COUNT(*) AS count FROM learning_events WHERE user_id='agree' AND eligible=1 GROUP BY word_id",
      )
      .all()
      .map((r) => [r.word_id, r.count]);
  const progressRows = () =>
    db
      .prepare(
        "SELECT word_id,correct,run,recalls,mastered,seen,last_seen,retry_at FROM progress WHERE user_id='agree'",
      )
      .all()
      .map((r) => [
        r.word_id,
        r.correct,
        r.run,
        r.recalls,
        r.mastered,
        r.seen,
        r.last_seen,
        r.retry_at,
      ]);

  // Eighteen answers, so the run crosses the five-answer cap, the every-third
  // bonus more than once, words being finished, a wrong answer and a reveal. Each
  // answer is graded by a *fresh* engine seeded from the database, which is what a
  // page load actually gives the browser - and the point of the test is that a
  // reload does not change what a child is told they earned.
  const plan = [1, 1, 1, 0, 1, 1, 1, -1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1];
  let paid = 0;
  // No `cap` here, and that is a finding rather than an omission: a word is
  // retired at its recall target, which is at most four, so playing can never
  // reach five counted answers at one word. The cap is a backstop, exercised by
  // the flush suite against the SQL and by the reload test against the engine.
  const seen = { bonus: false, mastery: false, miss: false, reveal: false };
  for (const [i, intent] of plan.entries()) {
    const engine = engineFor({
      streak: wallet().streak,
      eligibleCounts: eligibleFromDb(),
      progress: progressRows(),
    });
    const question = engine.next();
    assert.ok(question, `answer ${i}: no question`);
    // The clock moves between the question being shown and it being answered,
    // which is the only place time passes in a practice session. Advance it
    // before `next()` instead and the elapsed time is zero, every answer reads
    // as "uncertain", and no word can ever be finished - so the mastery award
    // would silently go uncompared.
    tick();
    const right = question.choices.indexOf(question.answer);
    const pick = intent === -1 ? -1 : intent === 0 ? (right + 1) % 4 : right;
    const graded = engine.grade(pick);
    assert.ok(graded, `answer ${i}: nothing to grade`);

    // The same answer written to the database, with eligibility derived exactly
    // as the flush derives it, and the trigger doing the awarding.
    const id = `a-${i}`;
    const wordId = question.wordId;
    const before = db
      .prepare(
        "SELECT correct,mastered FROM progress WHERE user_id='agree' AND word_id=?",
      )
      .get(wordId) ?? { correct: 0, mastered: 0 };
    db.prepare(
      "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed) VALUES(?,'agree',?,'[]',1,?,'x','p',1,?,?,1)",
    ).run(id, wordId, question.type, pick, graded.correct ? 1 : 0);
    db.prepare(
      "INSERT INTO progress(user_id,word_id,correct,seen,retry_at) VALUES('agree',?,0,0,NULL) ON CONFLICT(user_id,word_id) DO NOTHING",
    ).run(wordId);
    db.prepare(
      // Eligibility is derived in SQL from the running counters, so the engine's
      // own eligibility is a genuine check against it. Mastery is not: the app
      // decides which answer finished the word and SQL only refuses to pay the
      // same word twice, exactly as the flush does.
      `INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered,evidence)
       SELECT ?,'agree',a.word_id,1,'2026-09-29',a.is_correct,?,
         CASE WHEN a.is_correct=1 AND p.mastered=0 AND p.correct<?
                AND (SELECT COUNT(*) FROM learning_events e WHERE e.user_id='agree' AND e.word_id=a.word_id AND e.eligible=1)<? THEN 1 ELSE 0 END,
         CASE WHEN ?=1 AND NOT EXISTS(SELECT 1 FROM learning_events e
                  WHERE e.user_id='agree' AND e.word_id=a.word_id AND e.mastered=1) THEN 1 ELSE 0 END,
         'x'
       FROM attempts a JOIN progress p ON p.user_id='agree' AND p.word_id=a.word_id
       WHERE a.id=?`,
    ).run(
      id,
      pick === -1 ? 1 : 0,
      CUMULATIVE_FLOOR,
      ELIGIBLE_ANSWERS,
      graded.newlyMastered ? 1 : 0,
      id,
    );

    const event = db
      .prepare(
        "SELECT base_credits AS base, streak_credits AS bonus, mastery_credits AS mastery, eligible, mastered FROM learning_events WHERE attempt_id=?",
      )
      .get(id);
    assert.ok(event, `answer ${i}: the trigger recorded no award event`);
    assert.equal(
      graded.award.base,
      event.base,
      `answer ${i}: base credits differ`,
    );
    assert.equal(
      graded.award.streak,
      event.bonus,
      `answer ${i}: streak bonus differs`,
    );
    assert.equal(
      graded.award.mastery,
      event.mastery,
      `answer ${i}: mastery credits differ`,
    );
    assert.equal(
      wallet().streak,
      graded.award.currentStreak,
      `answer ${i}: the running streak differs`,
    );
    // The two decisions themselves, checked directly. Without these the credit
    // comparison above could pass only because both sides read the same wrong
    // number, which is the failure mode this test exists to catch.
    assert.equal(
      graded.award.base > 0,
      event.eligible === 1,
      `answer ${i}: the engine and the database disagree on whether this counted`,
    );
    assert.equal(
      graded.award.mastery > 0,
      event.mastered === 1,
      `answer ${i}: the engine and the database disagree on the mastery award`,
    );

    if (event.bonus > 0) seen.bonus = true;
    if (event.mastery > 0) seen.mastery = true;
    if (pick === -1) seen.reveal = true;
    if (pick >= 0 && !graded.correct) seen.miss = true;
    paid += event.base + event.bonus + event.mastery;

    // The flush writes the browser's counters after the events, in that order, so
    // eligibility above read the pre-answer state exactly as it would in life.
    const after = engine.pending().progress.find((row) => row[0] === wordId);
    db.prepare(
      "UPDATE progress SET correct=?,run=?,recalls=?,mastered=?,seen=? WHERE user_id='agree' AND word_id=?",
    ).run(after[1], after[2], after[3], after[4], after[5], wordId);
  }

  // Each of these has to have happened, or the test is comparing numbers that
  // never diverge and would pass against a broken engine.
  assert.ok(
    seen.bonus,
    "the run never paid a streak bonus, so the bonus went uncompared",
  );
  assert.ok(
    seen.mastery,
    "the run never finished the word, so the mastery award went uncompared",
  );
  assert.ok(seen.miss, "the run never got one wrong");
  assert.ok(seen.reveal, "the run never revealed an answer");
  assert.ok(paid > 0, "the run should have paid something");
  assert.equal(
    wallet().balance,
    paid,
    "the wallet must hold exactly what the run was told it earned",
  );
  db.close();
});

test("the award uses the account's starting streak, not a fresh one", () => {
  // A child two answers into a streak is owed the bonus on their next one. Started
  // from zero instead, the bonus would land a whole cycle late and the balance
  // would be wrong for the whole session.
  const started = engineFor({ streak: 2 });
  const question = started.next();
  const right = question.choices.indexOf(question.answer);
  const graded = started.grade(right);
  assert.equal(
    graded.award.streak,
    STREAK_BONUS,
    "the third consecutive counted answer pays the bonus",
  );
  assert.equal(graded.award.base, BASE_CREDITS);
  assert.equal(graded.award.currentStreak, 3);

  const fromZero = engineFor({ streak: 0 });
  const other = fromZero.next();
  const fresh = fromZero.grade(other.choices.indexOf(other.answer));
  assert.equal(
    fresh.award.streak,
    0,
    "from zero, the first answer is not the third",
  );
});

test("a word that has already paid five times does not pay again, after a reload", () => {
  // The cap cannot normally be reached by playing - a word is retired at its
  // recall target, which is at most four, so it stops being offered before a
  // fifth counted answer. It is a backstop against credits being farmed, and the
  // flush enforces it in SQL. What the engine has to get right is narrower and
  // more important: after a page load it must know a word has already paid, or a
  // child could reload their way to a sixth award the browser believes in.
  const only = { allowedWordIds: new Set(["abandon"]) };
  const unpaid = engineFor({ ...only, eligibleCounts: [] });
  const first = unpaid.next();
  const paid = unpaid.grade(first.choices.indexOf(first.answer));
  assert.equal(paid.award.base, BASE_CREDITS, "an unpaid word pays");

  // A fresh engine, seeded only with what the server told it. Nothing else
  // carries over - this is a reload.
  const reloaded = engineFor({ ...only, eligibleCounts: [["abandon", 5]] });
  const again = reloaded.next();
  const capped = reloaded.grade(again.choices.indexOf(again.answer));
  assert.equal(
    capped.award.base,
    0,
    "a word that has paid five times must not pay a sixth, however it was loaded",
  );
  assert.equal(capped.award.total, 0, "and pays nothing at all");
  assert.equal(
    reloaded.creditStreak,
    0,
    "and does not advance the streak, since it did not count",
  );

  // One short of the cap still pays, so the test is not passing on an off-by-one
  // in the other direction.
  const nearly = engineFor({
    ...only,
    eligibleCounts: [["abandon", ELIGIBLE_ANSWERS - 1]],
  });
  const last = nearly.next();
  const still = nearly.grade(last.choices.indexOf(last.answer));
  assert.equal(
    still.award.base,
    BASE_CREDITS,
    "the fifth counted answer still pays",
  );
});

test("a reveal is worth nothing, and it breaks the streak", () => {
  // Not what I expected when writing this, and worth being explicit about: the
  // trigger opens with `CASE WHEN NEW.correct=0 THEN 0`, and a reveal is stored
  // with correct=0, so asking for the answer *does* clear the streak. It has
  // always behaved this way - the client did not introduce it - but the child can
  // now see the streak move, so it is worth knowing about. An assisted answer is
  // different: it is stored as correct but uncounted, so it neither breaks nor
  // advances the streak.
  const engine = engineFor({ streak: 2 });
  engine.next();
  const graded = engine.grade(-1);
  assert.equal(graded.award.total, 0, "a reveal pays nothing");
  assert.equal(
    graded.award.currentStreak,
    0,
    "and clears the streak, as the trigger does",
  );

  const assisted = engineFor({ streak: 2 });
  const second = assisted.next();
  const helped = assisted.grade(second.choices.indexOf(second.answer), {
    assisted: true,
  });
  assert.ok(helped, "an assisted answer is still an answer");
  assert.equal(helped.award.total, 0, "and pays nothing");
  assert.equal(
    helped.award.currentStreak,
    2,
    "but leaves the streak alone, because it was right",
  );
});

test("the mastery award is paid once per word, not once per answer", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  db.prepare(
    "INSERT INTO users(id,email,password,created_at) VALUES('twice','t@example.test','x',0)",
  ).run();
  const masteryEvents = () =>
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM learning_events WHERE user_id='twice' AND mastered=1",
      )
      .get().c;
  // A client that claims every answer finished the word is the shape of an
  // attack, and the answer the first guard is there to give.
  for (const i of [0, 1, 2]) {
    const id = `m-${i}`;
    db.prepare(
      "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed) VALUES(?,'twice','abandon','[]',1,'def','x','p',1,0,1,1)",
    ).run(id);
    db.prepare(
      "INSERT INTO progress(user_id,word_id,correct,seen,retry_at) VALUES('twice','abandon',0,1,NULL) ON CONFLICT(user_id,word_id) DO NOTHING",
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered,evidence)
       SELECT ?,'twice','abandon',1,'2026-09-29',1,0,
         CASE WHEN p.correct<5 AND (SELECT COUNT(*) FROM learning_events e WHERE e.user_id='twice' AND e.word_id='abandon' AND e.eligible=1)<5 THEN 1 ELSE 0 END,
         CASE WHEN 1=1 AND NOT EXISTS(SELECT 1 FROM learning_events e WHERE e.user_id='twice' AND e.word_id='abandon' AND e.mastered=1) THEN 1 ELSE 0 END,
         'x'
       FROM attempts a JOIN progress p ON p.user_id='twice' AND p.word_id='abandon' WHERE a.id=?`,
    ).run(id, id);
  }
  assert.equal(
    masteryEvents(),
    1,
    "three claims that the word was finished pay once",
  );
  assert.equal(
    db.prepare("SELECT balance FROM credit_wallets WHERE user_id='twice'").get()
      .balance,
    BASE_CREDITS * 3 + STREAK_BONUS + MASTERY_CREDITS,
    "three base awards, the every-third bonus and one mastery award - not three mastery awards",
  );
  db.close();
});
