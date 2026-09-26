import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local previews only.");
if (!process.env.TEST_NODE_DB)
  throw Error("Set TEST_NODE_DB to the local preview SQLite database.");
const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
let cookie = "",
  userId;
async function call(path, data, headers = {}) {
  const response = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...headers,
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
const story = JSON.parse(readFileSync("data/stories/level-1.txt", "utf8"))[0],
  storyId = story.id,
  owner = randomUUID();
const post = (data, headers) =>
  call("/api/stories", { storyId, ...data }, headers);
try {
  const catalog = await call("/api/stories");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.stories.length, 60);
  const detail = await call(`/api/stories?id=${storyId}`);
  assert.equal(detail.status, 200);
  assert.equal("answer" in detail.data.question, false);
  assert.equal(detail.data.vocabulary.length, 15);
  assert.equal((await call("/api/stories?id=missing")).status, 404);
  assert.equal((await post({ action: "start", owner })).status, 401);
  const registration = await call("/api/auth/register", {
    email: `story-${randomUUID()}@example.test`,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(registration.status, 200);
  cookie = registration.cookie.split(";")[0];
  userId = registration.data.user.id;
  assert.equal(
    (
      await post(
        { action: "start", owner },
        { Origin: "https://unrelated.test" },
      )
    ).status,
    403,
  );
  assert.equal((await post({ action: "start", owner: "bad" })).status, 400);
  assert.equal(
    (await post({ action: "time", owner, sequence: 1, seconds: 15 })).status,
    409,
  );
  assert.equal((await post({ action: "start", owner })).status, 200);
  assert.equal(
    (await post({ action: "time", owner, sequence: 1, seconds: 0 })).status,
    200,
  );
  assert.equal(
    (await post({ action: "complete", answer: story.question.answer })).status,
    409,
  );
  assert.equal(
    (await post({ action: "time", owner, sequence: 2, seconds: 31 })).status,
    400,
  );
  assert.equal(
    (await post({ action: "time", owner, sequence: 2, seconds: -1 })).status,
    400,
  );
  // Advance only the test user's stored checkpoint clock to exercise server bounds without sleeping.
  const rewind = () =>
    db
      .prepare("UPDATE study_clock SET last_at=? WHERE user_id=?")
      .run(Date.now() - 30000, userId);
  for (let sequence = 2; sequence <= 4; sequence++) {
    rewind();
    const tick = await post({ action: "time", owner, sequence, seconds: 30 });
    assert.equal(tick.status, 200);
  }
  const progress = () =>
    db
      .prepare("SELECT seconds FROM story_reads WHERE user_id=? AND story_id=?")
      .get(userId, storyId).seconds;
  assert.equal(progress(), 90);
  await post({ action: "time", owner, sequence: 4, seconds: 30 });
  assert.equal(progress(), 90, "retry must not count twice");
  const clockBefore = db
    .prepare("SELECT * FROM study_clock WHERE user_id=?")
    .get(userId);
  await post({ action: "start", owner });
  assert.deepEqual(
    db.prepare("SELECT * FROM study_clock WHERE user_id=?").get(userId),
    clockBefore,
    "same start must preserve clock",
  );
  const otherOwner = randomUUID();
  await post({ action: "time", owner: otherOwner, sequence: 1, seconds: 30 });
  assert.equal(progress(), 90, "another tab cannot double-count");
  assert.equal(
    (
      await post({
        action: "complete",
        answer: (story.question.answer + 1) % 3,
      })
    ).status,
    422,
  );
  assert.equal((await post({ action: "complete", answer: 9 })).status, 400);
  const finishes = await Promise.all([
    post({ action: "complete", answer: story.question.answer }),
    post({ action: "complete", answer: story.question.answer }),
  ]);
  assert.ok(finishes.every((x) => x.status === 200));
  assert.equal(
    finishes.reduce((sum, x) => sum + x.data.credits, 0),
    10,
  );
  assert.equal(
    (await post({ action: "complete", answer: story.question.answer })).data
      .credits,
    0,
  );
  const rewards = await call("/api/rewards");
  assert.equal(rewards.data.rewards.balance, 10);
  assert.equal(
    rewards.data.transactions.filter((t) => t.reason === "story").length,
    1,
  );
  const calendar = await call("/api/calendar");
  assert.equal(calendar.data.totals.stories, 1);
  assert.equal(calendar.data.totals.seconds, 90);
  assert.equal(calendar.data.totals.mastered, 0);
  assert.equal(
    (await call("/api/stories")).data.stories.find((s) => s.id === storyId)
      .completed,
    true,
  );
  // A new story starts immediately; no 35-second lease gap from the previous page.
  const secondId = "level-1-02",
    nextOwner = randomUUID();
  assert.equal(
    (await post({ action: "start", storyId: secondId, owner: nextOwner }))
      .status,
    200,
  );
  rewind();
  await post({
    action: "time",
    storyId: secondId,
    owner: nextOwner,
    sequence: 1,
    seconds: 15,
  });
  assert.equal(
    db
      .prepare("SELECT seconds FROM story_reads WHERE user_id=? AND story_id=?")
      .get(userId, secondId).seconds,
    15,
  );
  // Level 0 is a real level: its stories bookmark, start, tick and finish like any other.
  const levelZero = JSON.parse(
    readFileSync("data/stories/level-0.txt", "utf8"),
  )[0];
  const zeroId = levelZero.id;
  const zeroOwner = randomUUID();
  const zeroPost = (data) => call("/api/stories", { storyId: zeroId, ...data });
  assert.equal(
    (
      await zeroPost({
        action: "bookmark",
        paragraph: 0,
        fraction: 0,
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (await zeroPost({ action: "start", owner: zeroOwner })).status,
    200,
  );
  rewind();
  assert.equal(
    (
      await zeroPost({
        action: "time",
        owner: zeroOwner,
        sequence: 1,
        seconds: 30,
      })
    ).status,
    200,
  );
  assert.equal(
    (await zeroPost({ action: "complete", answer: levelZero.question.answer }))
      .status,
    409,
    "the reading-time floor still applies at level 0",
  );
  for (let sequence = 2; sequence <= 4; sequence++) {
    rewind();
    assert.equal(
      (
        await zeroPost({
          action: "time",
          owner: zeroOwner,
          sequence,
          seconds: 30,
        })
      ).status,
      200,
    );
  }
  const finishedZero = await zeroPost({
    action: "complete",
    answer: levelZero.question.answer,
  });
  assert.equal(finishedZero.status, 200);
  assert.equal(finishedZero.data.credits, 10);
  assert.equal(
    (await call("/api/stories")).data.stories.find((s) => s.id === zeroId)
      .completed,
    true,
  );
  assert.equal(
    (
      await post({
        action: "start",
        storyId: "level-6-01",
        owner: randomUUID(),
      })
    ).status,
    400,
    "a story outside levels 0-5 is rejected",
  );
  cookie = "";
  assert.equal(
    (await call(`/api/stories?id=${storyId}`)).data.progress.completedAt,
    null,
  );
  console.log(
    "Story API passed: guest access, auth, origin, timing, retry/tab deduplication, questions, concurrent awards, navigation, level 0 stories, rewards and calendar.",
  );
} finally {
  if (userId) db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.close();
}
