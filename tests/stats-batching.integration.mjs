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
 * Needs a running preview and a handle on its SQLite file, so like the other
 * integration suites it is not part of `npm test` - it cannot be, it has to talk
 * to a live server:
 *   npm run dev:node
 *   TEST_NODE_DB=$PWD/.sites-runtime/node-dev.sqlite npm run test:stats-batching
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  confirmAddress,
  credentials,
  post as postJson,
} from "./helpers/account.mjs";
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
  const password = `Test-only-${randomUUID()}`;
  const email = `stats-batching-${randomUUID()}@example.test`;
  const r = await call("/api/auth/register", { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Registration hands out no session now, so the cookie comes from a sign-in.
  // `call` sets the module-level cookie from the response, so the sign-in below is
  // all this needs to do.
  confirmAddress(email);
  await call("/api/auth/login", { email, password });
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
  const wallet = db
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
    console.log(
      `  FAIL ${label}\n       got  ${JSON.stringify(actual)}\n       want ${JSON.stringify(want)}`,
    );
  }
}

try {
  const userId = await register();

  // Force the free tier before anything else.
  //
  // A brand-new account is inside its trial, and a trial grants full access, so
  // the route calls `statsFor(user.id)` with no allowed-word set. That skips the
  // optional progress read entirely - and that read is the one whose position in
  // the batch moves, so it is the one most worth testing. Backdating the account
  // past its trial is what makes the free-tier branch run at all; without this
  // the test passes without ever touching the code it is aimed at.
  db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
    Date.now() - 60 * 24 * 60 * 60 * 1000,
    userId,
  );

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

  // A word this child has met that is *not* in their free set. A free-tier child
  // can only be shown free words, so playing cannot produce this row; it stands
  // in for a word met before a trial lapsed. It is what makes the filtered count
  // differ from the lifetime total - without it, a child whose progress is all
  // allowed words gets the same number from either branch and the assertion below
  // would pass even if the wrong branch ran.
  const OUTSIDER = "not-in-the-free-collection";
  db.prepare(
    "INSERT OR IGNORE INTO progress(user_id,word_id,correct,seen,last_seen,retry_at) VALUES(?,?,1,1,?,NULL)",
  ).run(userId, OUTSIDER, Date.now());

  // A word that *is* allowed and *is* mastered, so the mastered count is not
  // 0-against-0. Reaching that by playing takes five eligible correct answers on
  // one word (CUMULATIVE_FLOOR), which is not a fixture worth building, so the
  // row is planted. A green 0 === 0 asserts nothing, and this is the check that
  // would notice the progress statement being read from the wrong offset when
  // the wrong statement still happens to yield a number.
  const planted = db
    .prepare(
      "SELECT word_id FROM attempts WHERE user_id=? AND answered_at IS NOT NULL LIMIT 1",
    )
    .get(userId);
  assert.ok(
    planted,
    "expected an answered attempt to plant a mastered word on",
  );
  db.prepare(
    "UPDATE progress SET correct=6,mastered=1 WHERE user_id=? AND word_id=?",
  ).run(userId, planted.word_id);

  // A finished story today, so the mission's story count is not 0-against-0
  // either: the mission statement selects two things and only one of them was
  // actually being covered. The row is planted because finishing a story through
  // the API is another suite's job, and the table wants a real story id.
  const realStory = db
    .prepare("SELECT id FROM stories ORDER BY id LIMIT 1")
    .get();
  assert.ok(realStory, "expected at least one story in the library");
  db.prepare(
    "INSERT OR IGNORE INTO daily_story_finishes(user_id,story_id,day,created_at) VALUES(?,?,?,?)",
  ).run(userId, realStory.id, localDay(Date.now()), Date.now());

  const mounted = await call("/api/challenge");
  assert.equal(mounted.status, 200);
  const stats = mounted.data.stats;
  assert.ok(stats, "expected stats on the mount payload");
  // Record which branch ran, so a future change to the trial cannot quietly turn
  // this back into a test of the full-access path.
  assert.equal(
    mounted.data.freeTier,
    true,
    "expected a free-tier child; without one the optional progress read is skipped",
  );

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

  console.log(
    "\nthe batched summary must equal the serial reads, statement for statement",
  );

  check("rewards.balance", stats.rewards.balance, want.wallet.balance);
  check("rewards.streak", stats.rewards.streak, want.wallet.streak);
  check("rewards.bestStreak", stats.rewards.bestStreak, want.wallet.bestStreak);
  check("totalEarned (credit ledger SUM)", stats.totalEarned, want.totalEarned);
  check("mission.questions", stats.mission.questions, want.mission.questions);
  check("mission.stories", stats.mission.stories, want.mission.stories);
  check("mission.day", stats.mission.day, want.today);
  check("periods.today", stats.periods.today, period(want.today));
  check("periods.all", stats.periods.all, period(""));

  // The optional fifth read only runs for a free-tier child, and it is the one
  // whose position in the batch moves. Reading the wrong statement here would
  // still produce numbers - the mission row has `questions` and `stories`, and a
  // mis-sliced count is quietly plausible - so the count is compared against the
  // real rows, not against its type.
  //
  // The outsider row is excluded, which is the whole point: a full-access child
  // would report it in the lifetime totals and this assertion would fail.
  const progressRows = db
    .prepare("SELECT word_id,correct,mastered FROM progress WHERE user_id=?")
    .all(userId)
    .filter((r) => r.word_id !== OUTSIDER);
  assert.ok(
    progressRows.length > 0,
    "expected progress rows after answering, or the optional read is untested",
  );
  check(
    "meetCount counts only allowed words, not every progress row",
    stats.meetCount,
    progressRows.length,
  );
  check(
    "mastered counts only allowed words",
    stats.mastered,
    progressRows.filter((r) => r.mastered > 0).length,
  );
  // These three exist so none of the checks above can be 0-against-0 or
  // equal-by-construction, which is how the previous version of this test passed
  // while exercising none of the code it was written for.
  assert.ok(
    stats.mastered > 0,
    "the planted mastered word should make this non-zero, or the check is vacuous",
  );
  assert.ok(
    stats.mission.stories > 0,
    "the finished story should make this non-zero, or the check is vacuous",
  );
  assert.notEqual(
    stats.meetCount,
    progressRows.length + 1,
    "the outsider row must be excluded, so the counts have to differ",
  );

  // The other reachable shape: progressSummary() takes no options at all, so
  // this is a three-statement batch with neither optional read. It backs
  // /api/rewards, and it must not pick up a mission or a progress row.
  const rewards = await call("/api/rewards");
  assert.equal(rewards.status, 200, JSON.stringify(rewards.data));
  check(
    "rewards endpoint wallet balance matches",
    rewards.data.rewards?.balance,
    want.wallet.balance,
  );
  check(
    "rewards endpoint wallet streak matches",
    rewards.data.rewards?.streak,
    want.wallet.streak,
  );
  check(
    "rewards endpoint totalEarned matches",
    rewards.data.totalEarned,
    want.totalEarned,
  );
  check(
    "rewards endpoint periods.all matches",
    rewards.data.periods?.all?.questions,
    period("").questions,
  );
  assert.equal(
    rewards.data.meetCount,
    undefined,
    "the unbatched summary must not report a filtered meetCount",
  );
} finally {
  db.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nbatched summary matches the serial reads exactly");
