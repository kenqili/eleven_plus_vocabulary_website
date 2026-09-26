// Parent word settings: what a child practises is the shipped bank plus the
// parent's own words, minus whatever the parent has set aside.
import test from "node:test";
import assert from "node:assert/strict";
import { problemsForAddedWords } from "../lib/challenge/problems.ts";
import {
  difficultyForAddedWord,
  isAlreadyInBank,
  practiceWords,
  toCustomWord,
} from "../lib/challenge/added-words.ts";
import { words } from "../scripts/load-word-bank.mjs";

/** @returns {{id:string,word:string,definition:string,example:string,createdAt:number}} */
const added = (
  word,
  definition = "A meaning.",
  example = "An example sentence.",
) => ({
  id: `id-${word}`,
  word,
  definition,
  example,
  createdAt: 0,
});

test("a parent's own word never collides with a bank word id", () => {
  const custom = toCustomWord(added("Zebra", "A striped animal."));
  assert.equal(custom.id, "own:zebra");
  assert.ok(
    !words.some((word) => word.id === custom.id),
    "namespacing must keep progress rows separate from the shipped bank",
  );
  // The id is stable regardless of the capitalisation they typed.
  assert.equal(toCustomWord(added("ZEBRA")).id, custom.id);
  assert.equal(toCustomWord(added("  Zebra  ")).id, custom.id);
});

test("adding a word the bank already teaches is refused", () => {
  assert.ok(isAlreadyInBank("abandon", words), "abandon is in the bank");
  assert.ok(isAlreadyInBank("ABANDON", words), "matching should ignore case");
  assert.ok(!isAlreadyInBank("quaff", words), "quaff is not in the bank");
});

test("a word already in the bank is not added twice", () => {
  const pool = practiceWords([added("abandon"), added("quaff")], new Set(), words);
  const custom = pool.filter((word) => word.id.startsWith("own:"));
  assert.deepEqual(
    custom.map((word) => word.word),
    ["quaff"],
    "only the genuinely new word is added",
  );
  assert.equal(
    pool.filter((word) => word.id === "abandon").length,
    1,
    "the bank entry is not duplicated",
  );
});

test("setting a word aside removes it from practice and from the list", () => {
  const withWord = practiceWords([added("quaff")], new Set(), words);
  assert.ok(withWord.some((word) => word.id === "own:quaff"));
  const without = practiceWords(
    [added("quaff")],
    new Set(["own:quaff", "abandon"]),
    words,
  );
  assert.ok(!without.some((word) => word.id === "own:quaff"));
  assert.ok(
    !without.some((word) => word.id === "abandon"),
    "a set-aside bank word must not come back",
  );
  assert.equal(without.length, withWord.length - 2);
});

test("a parent's own word has no relations rather than invented ones", () => {
  const custom = toCustomWord(added("quaff"));
  assert.equal(custom.syn, "—");
  assert.equal(custom.ant, "—");
});

test("a parent's own word is banded by length and never out of range", () => {
  assert.equal(difficultyForAddedWord("quaff").difficulty, 0);
  assert.equal(difficultyForAddedWord("a").difficulty, 0);
  // Bands step up with length and stop at the hardest.
  assert.equal(difficultyForAddedWord("extraordinary").difficulty, 4);
  assert.equal(difficultyForAddedWord("counterbalanced").difficulty, 5);
  const levels = ["a", "quaff", "modest", "adequate", "assertive", "perplexing", "disinterested"].map(
    (word) => difficultyForAddedWord(word).difficulty,
  );
  assert.deepEqual([...levels].sort((x, y) => x - y), levels, "bands must not fall as words get longer");
  for (const word of ["a", "quaff", "counterbalanced", "antidisestablishmentarianism"]) {
    const info = difficultyForAddedWord(word);
    assert.ok(info.difficulty >= 0 && info.difficulty <= 5, word);
    assert.equal(info.letterCount, [...word].filter((c) => /\p{L}/u.test(c)).length);
    assert.equal(info.frequencyKind, "unavailable");
  }
});

test("a parent's own word gets four options drawn from the whole bank", () => {
  const custom = [toCustomWord(added("quaff", "To drink loudly.", "They quaffed it."))];
  const made = problemsForAddedWords(custom, words);
  const types = made.map((problem) => problem.type).sort();
  // No relations were supplied, so only the three types that need none.
  assert.deepEqual(types, ["cloze", "def", "word"]);
  for (const problem of made) {
    if (!problem.choices) continue;
    assert.equal(problem.choices.length, 4, problem.id);
    assert.equal(
      new Set(problem.choices.map((c) => c.toLowerCase())).size,
      4,
      `${problem.id}: options must differ`,
    );
    assert.ok(
      problem.choices.includes(problem.answer),
      `${problem.id}: the answer must be offered`,
    );
  }
  const word = made.find((problem) => problem.type === "word");
  assert.equal(word.prompt, "To drink loudly.");
  assert.ok(!word.prompt.toLowerCase().includes("quaff"));
  const cloze = made.find((problem) => problem.type === "cloze");
  assert.ok(cloze.prompt.includes("______"), "the blank must be present");
  assert.ok(!cloze.prompt.toLowerCase().includes("quaff"));
});

test("a definition that names its own word gets no word question", () => {
  const leaky = [toCustomWord(added("quaff", "A quaff is a loud drink."))];
  const made = problemsForAddedWords(leaky, words);
  assert.ok(
    !made.some((problem) => problem.type === "word"),
    "the prompt would give the answer away",
  );
  assert.ok(made.some((problem) => problem.type === "def"));
});
