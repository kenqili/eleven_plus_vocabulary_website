// The authoritative mastery path: what the pure function decides must be exactly what
// the server stores, credits and rotates on.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { words } from "../scripts/load-word-bank.mjs";
import { problems } from "../scripts/load-problem-bank.mjs";
import {
  CUMULATIVE_FLOOR,
  advanceMastery,
  initialMastery,
} from "../lib/challenge/mastery.ts";
import levels from "../data/word-levels/levels.json" with { type: "json" };

const origin = process.env.TEST_ORIGIN || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local previews only.");
if (!process.env.TEST_NODE_DB)
  throw Error("Set TEST_NODE_DB to the local preview SQLite database.");
const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
const level = (id) => levels.words[id].difficulty;
let cookie = "",
  userId;

async function call(path, data) {
  const response = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { error: text.slice(0, 200) };
  }
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get("set-cookie"),
  };
}
const next = (level) =>
  call("/api/challenge", { action: "next", types: ["def"], level });
const answer = (id, selected, elapsed, assisted = false) =>
  call("/api/challenge", { action: "answer", id, selected, elapsed, assisted });
const progressFor = (word) =>
  db
    .prepare(
      "SELECT correct,run,recalls,mastered FROM progress WHERE user_id=? AND word_id=?",
    )
    .get(userId, word);
const evidenceFor = (word) =>
  db
    .prepare(
      "SELECT evidence,eligible,mastered FROM learning_events WHERE user_id=? AND word_id=? ORDER BY created_at DESC,rowid DESC",
    )
    .all(userId, word);

/** Make one word the only candidate so the served question is predictable. */
async function isolate(target) {
  db.exec("BEGIN");
  db.prepare("DELETE FROM progress WHERE user_id=?").run(userId);
  const insert = db.prepare(
    "INSERT INTO progress(user_id,word_id,correct,seen,retry_at,mastered,run,recalls) VALUES(?,?,?,1,NULL,?,0,0)",
  );
  for (const word of words)
    insert.run(
      userId,
      word.id,
      word.id === target ? 0 : CUMULATIVE_FLOOR,
      word.id === target ? 0 : 1,
    );
  db.exec("COMMIT");
}
/** Make the question look like it has been open long enough to be a real read. */
function age(seconds) {
  db.prepare(
    "UPDATE attempts SET created_at=created_at-? WHERE user_id=? AND answered_at IS NULL",
  ).run(seconds * 1000, userId);
}
const correctChoice = (question) =>
  question.choices.indexOf(
    problems.find((p) => p.id === `def:${question.wordId}`).answer,
  );

try {
  const registration = await call("/api/auth/register", {
    email: `mastery-${randomUUID()}@example.test`,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(registration.status, 200, JSON.stringify(registration.data));
  cookie = registration.cookie.split(";")[0];
  userId = registration.data.user.id;
  const wallet = () =>
    db.prepare("SELECT balance FROM credit_wallets WHERE user_id=?").get(userId)
      .balance;
  const masteryCredits = (word) =>
    db
      .prepare(
        "SELECT COALESCE(SUM(mastery_credits),0) AS credits FROM learning_events WHERE user_id=? AND word_id=?",
      )
      .get(userId, word).credits;

  // A level 0 word needs two sure recalls, and the stored counters must match the
  // pure function exactly.
  const easy = words.find((word) => level(word.id) === 0).id;
  await isolate(easy);
  const first = await next("all");
  assert.equal(first.data.question.wordId, easy);
  age(6);
  const firstAnswer = await answer(
    first.data.question.id,
    correctChoice(first.data.question),
    6,
  );
  assert.equal(firstAnswer.data.feedback.correct, true);
  assert.equal(
    evidenceFor(easy)[0].evidence,
    "recalled",
    "an unhurried answer reads as recall",
  );
  assert.deepEqual(
    { ...progressFor(easy) },
    { correct: 1, run: 1, recalls: 1, mastered: 0 },
    "one sure recall must not master a level 0 word",
  );
  assert.equal(firstAnswer.data.feedback.mastery.target, 2);

  const second = await next("all");
  age(6);
  const secondAnswer = await answer(
    second.data.question.id,
    correctChoice(second.data.question),
    6,
  );
  assert.equal(
    secondAnswer.data.feedback.mastery.mastered,
    true,
    "two sure recalls master a level 0 word",
  );
  assert.equal(progressFor(easy).mastered, 1);
  assert.equal(masteryCredits(easy), 10, "mastery pays once");

  // A replay of the same answer must not pay or count twice.
  const replay = await answer(second.data.question.id, 0, 6);
  assert.equal(replay.status, 200);
  assert.equal(progressFor(easy).correct, 2);
  assert.equal(
    masteryCredits(easy),
    10,
    "a replayed answer cannot pay a second time",
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM learning_events WHERE user_id=?")
      .get(userId).n,
    2,
  );

  // The cumulative floor is the unconditional exit: a mistake between each pair of
  // right answers must not stop the word retiring.
  const stubborn = words.find((word) => level(word.id) === 5).id;
  await isolate(stubborn);
  for (let index = 0; index < CUMULATIVE_FLOOR; index++) {
    if (index) {
      const wrong = await next("all");
      const expectedWrong = correctChoice(wrong.data.question);
      assert.ok(expectedWrong >= 0, "the answer must be among the choices");
      age(1);
      await answer(wrong.data.question.id, (expectedWrong + 1) % 4, 1);
      assert.equal(progressFor(stubborn).run, 0, "a mistake clears the run");
    }
    const question = await next("all");
    age(1);
    await answer(
      question.data.question.id,
      correctChoice(question.data.question),
      1,
    );
  }
  const drained = progressFor(stubborn);
  assert.equal(drained.correct, CUMULATIVE_FLOOR);
  assert.equal(drained.recalls, 0, "none of these were sure recalls");
  assert.equal(
    drained.mastered,
    1,
    "five correct answers always retire a word",
  );
  assert.equal(masteryCredits(stubborn), 10);
  const eligible = db
    .prepare(
      "SELECT COUNT(*) AS n FROM learning_events WHERE user_id=? AND word_id=? AND eligible=1",
    )
    .get(userId, stubborn).n;
  assert.ok(eligible <= 5, "credits stay capped per word");

  // Using the clue must never be a cheaper route to mastery than knowing the word.
  const clued = words.find(
    (word) => level(word.id) === 5 && word.id !== stubborn,
  ).id;
  await isolate(clued);
  for (let index = 0; index < 3; index++) {
    const question = await next("all");
    age(6);
    await answer(
      question.data.question.id,
      correctChoice(question.data.question),
      6,
      true,
    );
  }
  assert.equal(evidenceFor(clued)[0].evidence, "assisted");
  assert.equal(
    progressFor(clued).mastered,
    0,
    "three clued answers must not master a word",
  );
  assert.equal(
    progressFor(clued).correct,
    3,
    "clued answers still count towards the total",
  );

  // A restored question cannot claim a fresh reading budget by posting a small time.
  const stale = words.find(
    (word) => level(word.id) === 0 && word.id !== easy && word.id !== clued,
  ).id;
  await isolate(stale);
  const cheat = await next("all");
  const cheatAnswer = await answer(
    cheat.data.question.id,
    correctChoice(cheat.data.question),
    5,
  );
  assert.equal(
    evidenceFor(stale)[0].evidence,
    "uncertain",
    "a brand new question is not evidence of a quick recall",
  );
  assert.equal(progressFor(stale).recalls, 0);
  assert.equal(cheatAnswer.data.feedback.correct, true);

  // The server path and the pure function agree for a whole run of answers.
  const simulated = words.find(
    (word) =>
      level(word.id) === 3 &&
      word.id !== easy &&
      word.id !== clued &&
      word.id !== stale,
  ).id;
  await isolate(simulated);
  let expected = initialMastery;
  const evidence = [
    "recalled",
    "uncertain",
    "recalled",
    "recalled",
    "recalled",
  ];
  for (const item of evidence) {
    const question = await next("all");
    assert.equal(question.data.question.wordId, simulated);
    expected = advanceMastery(expected, item, level(simulated));
    age(item === "recalled" ? 6 : 40);
    const selected =
      item === "missed" ? 3 : correctChoice(question.data.question);
    await answer(
      question.data.question.id,
      selected,
      item === "recalled" ? 6 : 40,
    );
    assert.deepEqual(
      { ...progressFor(simulated) },
      {
        correct: expected.correct,
        run: expected.run,
        recalls: expected.recalls,
        mastered: Number(expected.mastered),
      },
      `stored counters must match the pure function after ${item}`,
    );
  }
  assert.equal(expected.mastered, true, "level 3 needs four sure recalls");

  // A word whose progress row is missing must not silently swallow the answer.
  const orphan = words.find(
    (word) => ![easy, clued, stale, simulated, stubborn].includes(word.id),
  ).id;
  await isolate(orphan);
  const orphanQuestion = await next("all");
  db.prepare("DELETE FROM progress WHERE user_id=? AND word_id=?").run(
    userId,
    orphan,
  );
  age(6);
  const orphanAnswer = await answer(
    orphanQuestion.data.question.id,
    correctChoice(orphanQuestion.data.question),
    6,
  );
  assert.equal(orphanAnswer.data.feedback.correct, true);
  assert.equal(
    progressFor(orphan).correct,
    1,
    "a missing progress row is healed instead of losing the answer",
  );
  assert.ok(wallet() >= 0);
  // A stale row that already met the floor is finished, but a wrong answer must not
  // be able to cash in the mastery bonus.
  const staleRow = words.find(
    (word) =>
      ![easy, clued, stale, simulated, stubborn, orphan].includes(word.id),
  ).id;
  await isolate(staleRow);
  // Take the question first, then make the row stale, the way a legacy row could look.
  const staleQuestion = await next("all");
  assert.equal(staleQuestion.data.question.wordId, staleRow);
  db.prepare(
    "UPDATE progress SET correct=?,mastered=0,run=0,recalls=0 WHERE user_id=? AND word_id=?",
  ).run(CUMULATIVE_FLOOR, userId, staleRow);
  const correctIndex = correctChoice(staleQuestion.data.question);
  age(1);
  await answer(staleQuestion.data.question.id, (correctIndex + 1) % 4, 1);
  assert.equal(
    masteryCredits(staleRow),
    0,
    "a wrong answer cannot pay a mastery bonus",
  );
  assert.equal(
    progressFor(staleRow).mastered,
    1,
    "but the word is still finished",
  );
  assert.equal(
    (await next("all")).data.complete,
    true,
    "a finished word leaves the rotation whatever its flag said",
  );

  const ledger = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE user_id=? AND reason='learning'",
    )
    .get(userId).total;
  assert.equal(
    ledger,
    wallet(),
    "the credit wallet must still equal the credit ledger under the faster algorithm",
  );
  assert.ok(ledger > 0, "the account earned credits");

  console.log(
    "Mastery API passed: evidence classification, per-level targets, clean runs, the cumulative floor, clue handling, wall-clock checks, replay safety, stored-counter parity with the pure function and missing-row recovery.",
  );
} finally {
  if (userId) db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.close();
}
