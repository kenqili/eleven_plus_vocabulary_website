import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { words } from "../scripts/load-word-bank.mjs";
import { problems } from "../scripts/load-problem-bank.mjs";
import {
  DAILY_QUESTION_TARGET,
  missionProgress,
  missionMessage,
} from "../lib/challenge/mission.ts";
import {
  storyMeaning,
  storyRelated,
  wordClue,
} from "../lib/challenge/story-meanings.ts";
import {
  readBookmarks,
  saveBookmark,
} from "../lib/client/reading-bookmarks.ts";
const help = JSON.parse(readFileSync("data/learning/word-help.json"));
const contexts = JSON.parse(readFileSync("data/learning/story-meanings.json"));
const stories = [0, 1, 2, 3, 4, 5].flatMap((level) =>
  JSON.parse(readFileSync(`data/stories/level-${level}.txt`)),
);
test("daily adventure requires 20 attempts and one story, in either order", () => {
  assert.equal(DAILY_QUESTION_TARGET, 20);
  for (const questions of [0, 5, 10, 15, 19])
    assert.equal(
      missionProgress({ day: "2026-09-24", questions, stories: 1 }).complete,
      false,
    );
  assert.equal(
    missionProgress({ day: "2026-09-24", questions: 20, stories: 0 }).complete,
    false,
  );
  assert.equal(
    missionProgress({ day: "2026-09-24", questions: 20, stories: 1 }).complete,
    true,
  );
  assert.deepEqual(
    missionProgress({ day: "2026-09-24", questions: 23, stories: 2 }),
    { questions: 20, stories: 1, complete: true },
  );
  assert.match(
    missionMessage({ day: "", questions: 10, stories: 0 }),
    /Halfway/,
  );
  assert.match(
    missionMessage({ day: "", questions: 20, stories: 0 }),
    /Time for a story/,
  );
});
test("every word and problem has readable help and a clue without its exact answer", () => {
  assert.equal(Object.keys(help).length, words.length);
  for (const word of words) {
    assert.ok(help[word.id]?.meaning?.trim(), word.id);
    assert.ok(help[word.id].meaning.length <= 160, word.id);
    assert.ok(storyMeaning(word));
  }
  for (const problem of problems)
    assert.ok(
      wordClue(problem.wordId, problem.answer),
      `Missing or answer-leaking clue: ${problem.id}`,
    );
  for (const [id, meanings] of Object.entries(contexts)) {
    const story = stories.find((s) => s.id === id);
    assert.ok(story, id);
    for (const [word, meaning] of Object.entries(meanings)) {
      assert.ok(story.wordIds.includes(word), `${id}: ${word}`);
      assert.ok(meaning.meaning.trim());
    }
  }
  assert.equal(
    storyRelated(
      words.find((w) => w.id === "current"),
      "level-1-02",
    ).syn,
    "flow; stream",
  );
  assert.match(
    storyMeaning(
      words.find((w) => w.id === "current"),
      "level-1-02",
    ),
    /Water flowing/,
  );
  assert.match(
    storyMeaning(
      words.find((w) => w.id === "sanction"),
      "level-3-07",
    ),
    /permission/,
  );
});
test("guest bookmarks reject corrupt data and stay isolated by account", () => {
  const values = new Map();
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
    },
  });
  try {
    saveBookmark("guest", "level-1-01", {
      paragraph: 2,
      fraction: 0.25,
      updatedAt: 3,
    });
    assert.equal(readBookmarks("guest").stories["level-1-01"].paragraph, 2);
    assert.deepEqual(readBookmarks("another-user").stories, {});
    values.set(
      "minewords:reading:guest",
      '{"level":99,"stories":{"level-1-01":{"paragraph":-1,"fraction":2,"updatedAt":0}}}',
    );
    assert.deepEqual(readBookmarks("guest"), { level: 0, stories: {} });
    values.set("minewords:reading:guest", "bad json");
    assert.deepEqual(readBookmarks("guest").stories, {});
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else delete globalThis.localStorage;
  }
});
