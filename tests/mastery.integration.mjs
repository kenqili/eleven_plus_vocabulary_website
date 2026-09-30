// The authoritative mastery path: what the pure function decides must be exactly what
// the server stores, credits and rotates on.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { confirmAddress } from "./helpers/account.mjs";
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

/** Leave only the named words in rotation, so the served question is predictable. */
async function isolate(...targets) {
  const keep = new Set(targets);
  db.exec("BEGIN");
  db.prepare("DELETE FROM progress WHERE user_id=?").run(userId);
  const insert = db.prepare(
    "INSERT INTO progress(user_id,word_id,correct,seen,retry_at,mastered,run,recalls) VALUES(?,?,?,1,NULL,?,0,0)",
  );
  for (const word of words)
    insert.run(
      userId,
      word.id,
      keep.has(word.id) ? 0 : CUMULATIVE_FLOOR,
      keep.has(word.id) ? 0 : 1,
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
  const password = `Test-only-${randomUUID()}`;
  const email = `mastery-${randomUUID()}@example.test`;
  const registration = await call("/api/auth/register", { email, password });
  assert.equal(registration.status, 200, JSON.stringify(registration.data));
  // Registration hands out no session now, so the cookie comes from a sign-in.
  confirmAddress(email);
  cookie = (await call("/api/auth/login", { email, password })).cookie.split(
    ";",
  )[0];
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
    0,
    "a clued answer earns nothing towards mastery at all, so the clue is not a shortcut",
  );
  assert.equal(progressFor(clued).run, 0, "and it clears the run");

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

  // Study time is batched in the browser, so a five-minute claim is legal. The
  // server must still clamp it to the wall time that actually passed, or a
  // larger batch would become a way to claim study time that never happened.
  const timed = words.find(
    (word) =>
      ![easy, clued, stale, simulated, stubborn, orphan].includes(word.id),
  ).id;
  await isolate(timed);
  const timer = await next("all");
  assert.equal(timer.data.question.wordId, timed);
  const overBatch = await call("/api/rewards", {
    action: "time",
    owner: randomUUID(),
    sequence: 1,
    seconds: 300,
    since: Date.now(),
  });
  assert.equal(overBatch.status, 200, "a five-minute batch is accepted");
  const recorded = db
    .prepare(
      "SELECT COALESCE(SUM(seconds),0) AS seconds FROM study_ticks WHERE user_id=?",
    )
    .get(userId).seconds;
  assert.ok(
    recorded < 30,
    `a 300s claim sent milliseconds after the last tick records only the real seconds, got ${recorded}`,
  );
  assert.equal(
    (
      await call("/api/rewards", {
        action: "time",
        owner: randomUUID(),
        sequence: 1,
        seconds: 301,
        attemptId: timer.data.question.id,
      })
    ).status,
    400,
    "a batch beyond the five-minute window is rejected",
  );

  // The clamp above can be satisfied by a server that records nothing at all,
  // which is what it did: the first tick of a session computed MIN(claim, 0)
  // because the clock was created at "now" and then measured from it. That cost
  // 15 seconds a session while batches were 15 seconds and cost a whole batch
  // once they were 300, so a ten minute session recorded half its reading time.
  // A child who really has had the question open for the length of a batch must
  // have that batch recorded.
  db.prepare("DELETE FROM study_clock WHERE user_id=?").run(userId);
  const firstBatch = await call("/api/rewards", {
    action: "time",
    owner: randomUUID(),
    sequence: 1,
    seconds: 300,
    // The session began five minutes ago, which is what the server used to read
    // off a pending attempt's creation time.
    since: Date.now() - 300000,
  });
  assert.equal(firstBatch.status, 200);
  const firstTick = db
    .prepare(
      "SELECT seconds FROM study_ticks WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .get(userId).seconds;
  assert.equal(
    firstTick,
    300,
    "the first batch of a session records the time the child actually spent",
  );
  // And the clamp still holds for that first batch: claiming the full five
  // minutes after only half of it has passed records half, not all.
  db.prepare("DELETE FROM study_clock WHERE user_id=?").run(userId);
  await call("/api/rewards", {
    action: "time",
    owner: randomUUID(),
    sequence: 1,
    seconds: 300,
    since: Date.now() - 150000,
  });
  assert.equal(
    db
      .prepare(
        "SELECT seconds FROM study_ticks WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(userId).seconds,
    150,
    "but a first batch still cannot claim more than the wall time that passed",
  );

  // The guard that replaced the pending-attempt lookup. A client names its own
  // start time now, so naming last Tuesday must not backdate an afternoon of
  // study into today. The bound is one batch back, and a claim is capped at one
  // batch, so the worst a client can do is the same single batch a legitimate
  // first tick of a session records.
  db.prepare("DELETE FROM study_clock WHERE user_id=?").run(userId);
  await call("/api/rewards", {
    action: "time",
    owner: randomUUID(),
    sequence: 1,
    seconds: 300,
    since: Date.now() - 86400000 * 7,
  });
  assert.equal(
    db
      .prepare(
        "SELECT seconds FROM study_ticks WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(userId).seconds,
    300,
    "a start time from last week records one batch and no more, never an afternoon",
  );

  // And a start time in the future must not be able to record time that has not
  // happened, or to make the first tick of every session record nothing.
  db.prepare("DELETE FROM study_clock WHERE user_id=?").run(userId);
  await call("/api/rewards", {
    action: "time",
    owner: randomUUID(),
    sequence: 1,
    seconds: 300,
    since: Date.now() + 86400000,
  });
  assert.equal(
    db
      .prepare(
        "SELECT seconds FROM study_ticks WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(userId).seconds,
    0,
    "a start time in the future records nothing rather than a negative interval",
  );
  db.prepare("DELETE FROM study_ticks WHERE user_id=?").run(userId);

  // The dashboard totals come from the running counters the triggers maintain,
  // so they must agree with the events that maintain them. The progress table is
  // deliberately not the reference here: this fixture writes `mastered` straight
  // into it to build a known pool, which no trigger ever sees.
  const dashboard = await call("/api/rewards");
  assert.equal(dashboard.status, 200);
  const masteryEvents = db
    .prepare(
      "SELECT COUNT(*) AS n FROM learning_events WHERE user_id=? AND mastered=1",
    )
    .get(userId).n;
  assert.equal(
    dashboard.data.periods.all.mastered,
    masteryEvents,
    "the trigger-maintained total must match the mastery events that maintain it",
  );
  assert.equal(dashboard.data.totals.mastered, masteryEvents);
  assert.ok(
    dashboard.data.totals.newWords > 0,
    "lifetime words met is tracked",
  );
  assert.equal(
    dashboard.data.totals.newWords,
    db
      .prepare(
        "SELECT COUNT(DISTINCT word_id) AS n FROM learning_events WHERE user_id=?",
      )
      .get(userId).n,
    "words met must match the distinct words that were actually practised",
  );

  // A retired word must never come back. This guards a real regression: reading
  // only unretired rows hid the rows that decide retirement, so every mastered
  // word looked like one that had never been seen and was served again.
  // Two words are left unretired so the pool cannot simply be empty, which would
  // make the check pass without proving anything.
  const companion = words.find(
    (word) =>
      ![easy, clued, stale, simulated, stubborn, orphan, timed].includes(
        word.id,
      ),
  ).id;
  await isolate(easy, companion);
  // Either word may be served first, so drive the pool until `easy` is retired.
  for (let i = 0; i < 8 && !progressFor(easy).mastered; i++) {
    const question = await next("all");
    if (question.data.complete) break;
    age(6);
    await answer(
      question.data.question.id,
      correctChoice(question.data.question),
      6,
    );
  }
  assert.equal(
    progressFor(easy).mastered,
    1,
    "two sure recalls retire a level 0 word",
  );
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const question = await next("all");
    if (question.data.complete) break;
    seen.add(question.data.question.wordId);
  }
  assert.equal(
    seen.has(easy),
    false,
    "a mastered word must not reappear in the rotation",
  );
  assert.equal(
    seen.has(companion),
    true,
    "the word that is still in rotation is still served",
  );

  // The show count has to survive into the question. This guards a real
  // regression: `seen` was dropped from the progress query while that query was
  // being narrowed, and because the result is cast rather than checked, nothing
  // threw. Every read became `undefined || 0`, so the "New word" badge showed
  // for words the child had met many times, and the least-seen-first balancing
  // in chooseWord was handed a pool where every word looked equally new and so
  // stopped balancing. The seeded count is what makes this fail if the column
  // is ever dropped again - no other test here seeds a word seen more than once.
  const often = words.find(
    (word) =>
      ![
        easy,
        clued,
        stale,
        simulated,
        stubborn,
        orphan,
        timed,
        companion,
      ].includes(word.id),
  ).id;
  // Seeded after the isolate, which rebuilds every progress row with seen=1.
  const oftenSeen = 7;
  await isolate(often, companion);
  db.prepare("UPDATE progress SET seen=? WHERE user_id=? AND word_id=?").run(
    oftenSeen,
    userId,
    often,
  );
  assert.equal(
    db
      .prepare("SELECT seen FROM progress WHERE user_id=? AND word_id=?")
      .get(userId, often).seen,
    oftenSeen,
    "the seeded show count is in the database",
  );
  // The previous block left attempts behind, and both of them change which word
  // gets served without `seen` having anything to do with it: a pending
  // question is served again rather than a new one chosen, and the most
  // recently served word is excluded outright. With only two words in the pool
  // that exclusion takes one of them, so the attempt history has to go before
  // either of these can observe a choice made on the show count.
  const clearAttempts = () =>
    db.prepare("DELETE FROM attempts WHERE user_id=?").run(userId);
  // First consequence: the rotation balances on it. chooseWord serves the words
  // it has seen least, so the word shown once must win over the one shown seven
  // times. With the column missing, every row read as zero, the whole pool tied
  // on the same number, and this was settled by the random tiebreak instead.
  clearAttempts();
  const balanced = await next("all");
  assert.equal(
    balanced.data.question.wordId,
    companion,
    "the less-seen word is the one served",
  );
  // Second consequence: the count reaches the child. Left with only the seen
  // word in rotation, handing it out reports the incremented figure, so seven
  // shown before becomes eight here and the badge reads "Seen 8 times" rather
  // than "New word".
  await isolate(often);
  // The isolate rebuilds every row with seen=1, so the count is seeded again.
  db.prepare("UPDATE progress SET seen=? WHERE user_id=? AND word_id=?").run(
    oftenSeen,
    userId,
    often,
  );
  clearAttempts();
  const shown = await next("all");
  assert.equal(shown.data.question.wordId, often);
  assert.equal(
    shown.data.question.seen,
    oftenSeen + 1,
    "a word that has been shown before must report how many times",
  );
  assert.equal(
    db
      .prepare("SELECT seen FROM progress WHERE user_id=? AND word_id=?")
      .get(userId, often).seen,
    oftenSeen + 1,
    "and the stored count is incremented the same way",
  );

  console.log(
    "Mastery API passed: evidence classification, per-level targets, clean runs, the cumulative floor, clue handling, wall-clock checks, replay safety, stored-counter parity with the pure function, missing-row recovery, show counts, batched study time and trigger-maintained dashboard totals.",
  );
} finally {
  if (userId) db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.close();
}
