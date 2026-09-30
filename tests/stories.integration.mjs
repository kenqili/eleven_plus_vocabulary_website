import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  confirmAddress,
  credentials,
  post as postJson,
} from "./helpers/account.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { storyMinimumSeconds } from "../lib/challenge/stories.ts";
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
const stories = [0, 1, 2, 3, 4, 5].flatMap((level) =>
  JSON.parse(readFileSync(`data/stories/level-${level}.txt`, "utf8")),
);
const story = JSON.parse(readFileSync("data/stories/level-1.txt", "utf8"))[0],
  storyId = story.id,
  owner = randomUUID();
const post = (data, headers) =>
  call("/api/stories", { storyId, ...data }, headers);
try {
  const catalog = await call("/api/stories");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.stories.length, stories.length);
  const detail = await call(`/api/stories?id=${storyId}`);
  assert.equal(detail.status, 200);
  assert.equal("answer" in detail.data.question, false);
  // The number of marked targets varies per story (15-30 is the rule the
  // validator enforces), so assert against this story rather than a constant.
  assert.equal(detail.data.vocabulary.length, story.wordIds.length);
  assert.ok(
    story.wordIds.length >= 15 && story.wordIds.length <= 30,
    `story target count out of range: ${story.wordIds.length}`,
  );
  assert.equal(
    detail.data.vocabulary.every((word) => word && word.id),
    true,
    "every target word must resolve to a real bank entry",
  );
  assert.deepEqual(
    detail.data.vocabulary.map((word) => word.id).sort(),
    [...story.wordIds].sort(),
    "the vocabulary list is exactly the story's target words",
  );
  assert.equal((await call("/api/stories?id=missing")).status, 404);
  assert.equal((await post({ action: "start", owner })).status, 401);
  const password = `Test-only-${randomUUID()}`;
  const email = `story-${randomUUID()}@example.test`;
  const registration = await call("/api/auth/register", { email, password });
  assert.equal(registration.status, 200);
  // Registration hands out no session now, so the cookie comes from a sign-in.
  confirmAddress(email);
  cookie = (await call("/api/auth/login", { email, password })).cookie.split(
    ";",
  )[0];
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
  // The reading floor is checked before the answer is even looked at, and that
  // ordering is the only thing stopping a child being told the answer without
  // having read the story. A wrong answer below the floor must be refused for
  // the same reason a right one is, rather than quietly revealing it.
  assert.equal(
    (
      await post({
        action: "complete",
        answer: (story.question.answer + 1) % 3,
      })
    ).status,
    409,
    "a wrong answer below the reading floor is still refused",
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
  // Read for however long this story actually needs. The floor moves with the
  // story's length, so a fixed number of ticks would quietly start failing
  // every time an adventure is edited.
  let sequence = 5;
  while (progress() < storyMinimumSeconds(story)) {
    rewind();
    assert.equal(
      (await post({ action: "time", owner, sequence, seconds: 30 })).status,
      200,
    );
    sequence += 1;
  }
  // A wrong answer is a teaching moment: it succeeds, says it was wrong and
  // names the right option, and the story stays open and unfinished.
  const wrong = await post({
    action: "complete",
    answer: (story.question.answer + 1) % 3,
  });
  assert.equal(wrong.status, 200, JSON.stringify(wrong.data));
  assert.equal(wrong.data.complete, false);
  assert.equal(wrong.data.correct, false);
  assert.equal(wrong.data.credits, 0);
  assert.equal(wrong.data.answer, story.question.answer);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM story_completions WHERE user_id=? AND story_id=?",
      )
      .get(userId, storyId).n,
    0,
    "a wrong answer must not record a completion",
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
  // The calendar total is a whole-month sum and progress() is this one story,
  // so these are only equal because this is the only story read so far and the
  // run has not crossed midnight. If another story is read before this point,
  // compare against the sum of both instead of expecting a failure.
  assert.equal(
    calendar.data.totals.seconds,
    progress(),
    "every second read for this story is on the calendar",
  );
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
