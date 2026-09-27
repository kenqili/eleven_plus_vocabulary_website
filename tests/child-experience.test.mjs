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
  const byId = new Map(words.map((word) => [word.id, word]));
  for (const problem of problems) {
    const word = byId.get(problem.wordId);
    assert.ok(word, `${problem.id}: no such word in the bank`);
    // The word and cloze types ask for the word itself, so the example clue
    // would name the answer. They must offer no hint at all rather than a
    // leaking one.
    if (problem.type === "word" || problem.type === "cloze") {
      assert.equal(
        wordClue(word, problem.answer, problem.type),
        "",
        `${problem.id} must not offer a clue that names the answer`,
      );
      continue;
    }
    assert.ok(
      wordClue(word, problem.answer),
      `Missing or answer-leaking clue: ${problem.id}`,
    );
  }
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

test("the plain-language help can never fall behind the definition again", () => {
  // storyMeaning prefers the help over the definition, so a child reads the
  // help and the definition is what a parent or a validator sees. That split
  // let them drift: ten words whose definitions had been corrected still carried
  // help written against the old one, and the help for "queer" was still
  // teaching the sense the correction existed to stop teaching.
  //
  // The help is now carried on the word in the generated bank, which is
  // regenerated by the build, so it cannot drift in the first place. This checks
  // the two agree about which words are in it at all, which is the failure the
  // generator would otherwise hide.
  const bank = JSON.parse(
    readFileSync(new URL("../data/problem-bank.json", import.meta.url), "utf8"),
  );
  const helpColumn = bank.meta.wordColumns.indexOf("help");
  assert.ok(helpColumn > 0, "the bank no longer carries a help column");
  const clueColumn = bank.meta.wordColumns.indexOf("clue");
  assert.ok(clueColumn > 0, "the bank no longer carries a clue column");

  const missing = [];
  let identical = 0;
  for (const row of bank.words) {
    const id = row[0];
    const definition = row[2];
    const recorded = help[id];
    if (!recorded?.meaning) {
      missing.push(id);
      continue;
    }
    if (recorded.meaning === definition) identical += 1;
    else if (row[helpColumn] !== recorded.meaning)
      missing.push(`${id} (the bank and the help file disagree)`);
  }
  assert.deepEqual(
    missing.slice(0, 6),
    [],
    `${missing.length} words have help in one place and not the other`,
  );
  // Most help is a deliberate rewrite rather than a copy, which is the point of
  // having it. If this ever drops to nearly nothing the help has stopped doing
  // its job and is just duplicating the definition.
  assert.ok(
    identical < bank.words.length * 0.5,
    `${identical} of ${bank.words.length} helps are now identical to the definition, so the rewrite has stopped being one`,
  );
});

test("a clue is offered only where it cannot name the answer", () => {
  // A word has one recorded clue, and it is a sentence using the word. That is
  // fine for a question whose answer is a meaning, and it hands the answer over
  // for one whose answer is the word. So the rule is about the question type,
  // not about the data, and it is checked here through the function that
  // decides rather than by inspecting the column.
  //
  // Checked over every question rather than a sample. A leak hands a child the
  // answer dressed as help, and it is the kind of bug that only shows for the
  // one word in two thousand.
  const byId = new Map(words.map((word) => [word.id, word]));
  const askedForWord = [];
  const leaked = [];
  for (const problem of problems) {
    const word = byId.get(problem.wordId);
    if (!word) continue;
    const offered = wordClue(word, problem.answer, problem.type);
    if (problem.type === "word" || problem.type === "cloze") {
      if (offered) askedForWord.push(`${problem.type}:${problem.wordId}`);
      continue;
    }
    if (!offered) {
      // No clue is allowed where the answer is a meaning, because there is one
      // for every word and a question that cannot offer one is broken.
      if (word.clue) leaked.push(`${problem.id} has a clue but offers none`);
      continue;
    }
    const escaped = problem.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(offered))
      leaked.push(`${problem.id} clue contains the answer`);
  }
  assert.deepEqual(askedForWord.slice(0, 5), [], `${askedForWord.length} word or cloze questions offered a clue`);
  assert.deepEqual(leaked.slice(0, 5), [], `${leaked.length} clues are wrong`);
});
