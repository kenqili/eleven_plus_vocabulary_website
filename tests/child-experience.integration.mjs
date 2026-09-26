import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { localDay } from "../lib/challenge/rewards.ts";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) ||
  !process.env.TEST_NODE_DB
)
  throw Error("Use a local preview and set TEST_NODE_DB.");
const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000");
const users = [];
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
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get("set-cookie"),
  };
}
async function register() {
  const r = await call("/api/auth/register", {
    email: `child-test-${randomUUID()}@example.test`,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  users.push(r.data.user.id);
  cookie = r.cookie.split(";")[0];
  return r.data.user.id;
}
const story = JSON.parse(readFileSync("data/stories/level-1.txt"))[0];
const post = (data) => call("/api/stories", { storyId: story.id, ...data });
try {
  assert.equal(
    (await post({ action: "bookmark", paragraph: 0, fraction: 0, revision: 0 }))
      .status,
    401,
  );
  const user = await register(),
    firstCookie = cookie;
  let mission = (await call("/api/mission")).data.mission;
  assert.equal(mission.questions, 0);
  assert.equal(mission.stories, 0);
  let level = await call("/api/stories", {
    action: "level",
    level: 3,
    revision: 0,
  });
  assert.equal(level.status, 200);
  assert.equal(level.data.revision, 1);
  assert.equal(
    (await call("/api/stories", { action: "level", level: 4, revision: 0 }))
      .status,
    409,
  );
  assert.equal((await call("/api/stories")).data.preference.level, 3);
  assert.equal(
    (
      await post({
        action: "bookmark",
        paragraph: 99,
        fraction: 0,
        revision: 0,
      })
    ).status,
    400,
  );
  const bookmark = await post({
    action: "bookmark",
    paragraph: 2,
    fraction: 0.4,
    revision: 0,
  });
  assert.equal(bookmark.status, 200, JSON.stringify(bookmark.data));
  assert.equal(
    (await post({ action: "bookmark", paragraph: 0, fraction: 0, revision: 0 }))
      .status,
    409,
  );
  let detail = (await call("/api/stories?id=" + story.id)).data;
  assert.equal(detail.bookmark.paragraph, 2);
  assert.equal(detail.bookmark.fraction, 0.4);
  assert.equal(
    detail.progress.seconds,
    0,
    "bookmarks never manufacture reading time",
  );
  await register();
  assert.equal((await call("/api/stories?id=" + story.id)).data.bookmark, null);
  assert.equal((await call("/api/stories")).data.preference.level, 0);
  cookie = firstCookie;
  // Submit real attempts, including a reveal and a mistake. Neither query replays nor reveals add mission attempts.
  const ask = async (selected) => {
    const q = await call("/api/challenge", { action: "next", types: ["def"] });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    const row = db
      .prepare("SELECT answer FROM attempts WHERE id=?")
      .get(q.data.question.id);
    const correct = q.data.question.choices.indexOf(row.answer);
    const chosen =
      selected === "correct"
        ? correct
        : selected === "wrong"
          ? (correct + 1) % 4
          : -1;
    const payload = {
      action: "answer",
      id: q.data.question.id,
      selected: chosen,
      elapsed: 1,
    };
    const answer = await call("/api/challenge", payload);
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
    return { answer, payload };
  };
  await ask("reveal");
  assert.equal((await call("/api/mission")).data.mission.questions, 0);
  await ask("wrong");
  for (let i = 1; i < 19; i++) await ask("correct");
  assert.equal((await call("/api/mission")).data.mission.questions, 19);
  const twentieth = await ask("correct");
  assert.equal(twentieth.answer.data.stats.mission.questions, 20);
  await call("/api/challenge", twentieth.payload);
  assert.equal((await call("/api/mission")).data.mission.questions, 20);
  const owner = randomUUID();
  await post({ action: "start", owner });
  assert.equal(
    (await post({ action: "complete", answer: story.question.answer })).status,
    409,
  );
  for (let sequence = 1; sequence <= 4; sequence++) {
    db.prepare("UPDATE study_clock SET last_at=? WHERE user_id=?").run(
      Date.now() - 30000,
      user,
    );
    assert.equal(
      (await post({ action: "time", owner, sequence, seconds: 30 })).status,
      200,
    );
  }
  const first = await post({
    action: "complete",
    answer: story.question.answer,
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.credits, 10);
  assert.equal(first.data.mission.stories, 1);
  assert.equal(
    (await post({ action: "complete", answer: story.question.answer })).data
      .credits,
    0,
  );
  // Move only this test user's prior completion to yesterday; rereading must require fresh time.
  const yesterday = localDay(Date.now() - 86400000),
    today = localDay(Date.now());
  db.prepare("DELETE FROM daily_story_finishes WHERE user_id=?").run(user);
  db.prepare(
    "UPDATE story_completions SET day=?,created_at=? WHERE user_id=?",
  ).run(yesterday, Date.now() - 86400000, user);
  db.prepare(
    "UPDATE story_ticks SET day=?,previous_day=?,created_at=? WHERE user_id=?",
  ).run(yesterday, yesterday, Date.now() - 86400000 - 1, user);
  assert.equal(
    (await post({ action: "complete", answer: story.question.answer })).status,
    409,
    "old time cannot complete a reread",
  );
  for (let sequence = 5; sequence <= 8; sequence++) {
    db.prepare("UPDATE study_clock SET last_at=? WHERE user_id=?").run(
      Date.now() - 30000,
      user,
    );
    await post({ action: "time", owner, sequence, seconds: 30 });
  }
  assert.equal(
    (
      await post({
        action: "complete",
        answer: (story.question.answer + 1) % 3,
      })
    ).status,
    422,
  );
  const reread = await post({
    action: "complete",
    answer: story.question.answer,
  });
  assert.equal(reread.status, 200, JSON.stringify(reread.data));
  assert.equal(reread.data.credits, 0);
  assert.equal(reread.data.mission.stories, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM credit_transactions WHERE user_id=? AND reason='story'",
      )
      .get(user).n,
    1,
  );
  const before = (await call("/api/rewards")).data;
  assert.ok(before.totalEarned >= 20);
  // More than one history page must still produce complete collection totals.
  for (let i = 0; i < 32; i++) {
    db.prepare(
      "UPDATE credit_wallets SET balance=balance+20 WHERE user_id=?",
    ).run(user);
    if (i < 30) {
      const r = await call("/api/rewards", {
        action: "redeem",
        badgeId: "spark",
        requestKey: randomUUID(),
      });
      assert.equal(r.status, 200);
    } else {
      db.prepare(
        "INSERT INTO badge_redemptions(id,user_id,request_key,badge_id,badge_name,cost,created_at) VALUES(?,?,?,'spark','Vocabulary Spark',20,?)",
      ).run(randomUUID(), user, randomUUID(), Date.now());
    }
  }
  const rewards = (await call("/api/rewards?offset=30")).data;
  assert.equal(rewards.collection.spark, 32);
  assert.equal(
    rewards.totalEarned,
    before.totalEarned,
    "spending does not reduce lifetime earned",
  );
  db.prepare("UPDATE daily_stats SET day=? WHERE user_id=? AND day=?").run(
    yesterday,
    user,
    today,
  );
  db.prepare("DELETE FROM daily_story_finishes WHERE user_id=? AND day=?").run(
    user,
    today,
  );
  mission = (await call("/api/mission")).data.mission;
  assert.equal(mission.questions, 0);
  assert.equal(mission.stories, 0);
  console.log(
    "PASS: 20-question goal, reveals, mistakes, replay, account isolation, level sync, stale bookmarks, reread time and credit protection, daily reset, complete badge totals.",
  );
} finally {
  for (const id of users) db.prepare("DELETE FROM users WHERE id=?").run(id);
  db.close();
}
