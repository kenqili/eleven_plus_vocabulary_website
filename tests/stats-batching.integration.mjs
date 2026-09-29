/**
 * The stats summary is read in one batched round trip instead of five serial
 * ones, because it used to account for a third of every question's database
 * latency. Batching changes how the rows are fetched, so the thing that has to
 * be proven is that it changes nothing about what comes back: same rows, same
 * order, same numbers.
 *
 * This does not re-derive the summary from the batch. It computes what the
 * summary should be by querying the same SQLite file directly, one statement at
 * a time, the way the serial code did, and asserts the API agrees. A batch that
 * returned its results out of order, dropped the last statement, or mis-sliced
 * the optional reads would pass every other test in the repository.
 *
 * Run against the local preview:
 *   npm run dev:node
 *   TEST_NODE_DB=$PWD/.sites-runtime/node-dev.sqlite npm run test:stats-batching
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { localDay } from "../lib/challenge/rewards.ts";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) ||
  !process.env.TEST_NODE_DB
)
  throw Error("Use a local preview (npm run dev:node) and set TEST_NODE_DB.");

const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000");
let cookie = "";

async function call(path, data) {
  const response = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, data: result };
}

async function register() {
  const r = await call("/api/auth/register", {
    email: `stats-batching-${randomUUID()}@example.test`,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.user.id;
}

/**
 * The serial version of the summary, written the way the code was before it was
 * batched: each statement on its own, in the order the old code issued them.
 */
function expectedSummary(userId) {
  const today = localDay(Date.now());
  const rows = db
    .prepare(
      `SELECT day,questions,correct,reveals,new_words AS newWords,mastered,seconds,credits,stories
       FROM daily_stats WHERE user_id=?`,
    )
    .all(userId);
  const wallet =
    db
      .prepare(
        "SELECT balance,streak,best_streak AS bestStreak FROM credit_wallets WHERE user_id=?",
      )
      .get(userId) || { balance: 0, streak: 0, bestStreak: 0 };
  const earned = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE user_id=? AND amount>0",
    )
    .get(userId);
  const mission = db
    .prepare(
      `SELECT
         COALESCE((SELECT MAX(0,questions-reveals) FROM daily_stats WHERE user_id=? AND day=?),0) AS questions,
         (SELECT COUNT(*) FROM daily_story_finishes WHERE user_id=? AND day=?) AS stories`,
    )
    .get(userId, today, userId, today);
  return { rows, wallet, totalEarned: earned?.total ?? 0, mission, today };
}

const sum = (rows, key, from, to) =>
  rows
    .filter((r) => r.day >= from && r.day <= to)
    .reduce((total, r) => total + r[key], 0);

let failures = 0;
function check(label, actual, want) {
  try {
    assert.deepEqual(actual, want);
    console.log(`  ok   ${label}`);
  } catch {
    failures++;
    console.log(`  FAIL ${label}\n       got  ${JSON.stringify(actual)}\n       want ${JSON.stringify(want)}`);
  }
}

try {
  const userId = await register();

  // Answer a handful so the summary has real, trigger-maintained rows in it. A
  // new account's summary is all zeros, which would pass even if every read were
  // dropped. The mix matters: a correct answer is what pays credits and moves the
  // streak, a wrong one still counts a question, and a reveal counts a reveal, so
  // every column of the aggregate ends up non-zero and is actually tested.
  for (let i = 0; i < 6; i++) {
    const next = await call("/api/challenge", { action: "next" });
    assert.equal(next.status, 200, JSON.stringify(next.data));
    const question = next.data.question;
    assert.ok(question, "expected a question");
    // The payload deliberately does not carry the answer - a child must not be
    // able to read it off the question - so the fixture takes the answer from
    // the attempt row, which is the ground truth the server graded against.
    const attempt = db
      .prepare("SELECT answer,choices FROM attempts WHERE id=?")
      .get(question.id);
    assert.ok(attempt, `no attempt row for ${question.id}`);
    const stored = JSON.parse(attempt.choices);
    const right = stored.indexOf(attempt.answer);
    assert.ok(right >= 0, "the stored answer should be one of the choices");
    // A wrong answer is any other index; a reveal is -1.
    const selected = i === 5 ? -1 : i % 2 === 0 ? right : (right + 1) % 4;
    const answer = await call("/api/challenge", {
      action: "answer",
      id: question.id,
      selected,
      elapsed: 3,
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
  }

  const mounted = await call("/api/challenge");
  assert.equal(mounted.status, 200);
  const stats = mounted.data.stats;
  assert.ok(stats, "expected stats on the mount payload");

  const want = expectedSummary(userId);
  // Non-vacuity: a summary of zeros would agree with a broken batch for the
  // wrong reason, so require the fixture to have produced real movement.
  assert.ok(
    want.rows.length > 0 && want.rows[0].questions > 0,
    "fixture produced no daily_stats movement, so this test proves nothing",
  );
  const period = (from) => ({
    stories: sum(want.rows, "stories", from, want.today),
    questions: sum(want.rows, "questions", from, want.today),
    correct: sum(want.rows, "correct", from, want.today),
    reveals: sum(want.rows, "reveals", from, want.today),
    newWords: sum(want.rows, "newWords", from, want.today),
    mastered: sum(want.rows, "mastered", from, want.today),
    seconds: sum(want.rows, "seconds", from, want.today),
    credits: sum(want.rows, "credits", from, want.today),
  });

  console.log("\nthe batched summary must equal the serial reads, statement for statement");

  check("rewards.balance", stats.rewards.balance, want.wallet.balance);
  check("rewards.streak", stats.rewards.streak, want.wallet.streak);
  check("rewards.bestStreak", stats.rewards.bestStreak, want.wallet.bestStreak);
  check("totalEarned (credit ledger SUM)", stats.totalEarned, want.totalEarned);
  check("mission.questions", stats.mission.questions, want.mission.questions);
  check("mission.stories", stats.mission.stories, want.mission.stories);
  check("mission.day", stats.mission.day, want.today);
  check("periods.today", stats.periods.today, period(want.today));
  check("periods.all", stats.periods.all, period(""));
  check("dates.today", stats.dates.today, want.today);

  // The optional fifth read only runs for a free-tier child, and it is the one
  // whose position in the batch moves. It has to have been sliced out of the
  // right statement: reading the mission row as if it were progress, or reading
  // past the end, would show up here as a non-numeric count.
  const progressRows = db
    .prepare("SELECT word_id,correct,mastered FROM progress WHERE user_id=?")
    .all(userId);
  assert.ok(
    progressRows.length > 0,
    "expected progress rows after answering, or the optional read is untested",
  );
  check(
    "free-tier mastered count is a number, not the mission row",
    typeof stats.mastered,
    "number",
  );
  check(
    "meetCount is a number, not undefined",
    typeof stats.meetCount,
    "number",
  );
} finally {
  db.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nbatched summary matches the serial reads exactly");
