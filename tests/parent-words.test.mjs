// Parent word settings: what a child practises is the shipped bank plus the
// parent's own words, minus whatever the parent has set aside.
import test from "node:test";
import assert from "node:assert/strict";
import { problemsForAddedWords } from "../lib/challenge/problems.ts";
import { problems as bankProblems } from "../scripts/load-problem-bank.mjs";
import { chosenWordExplanation, optionGlosses } from "../lib/challenge/option-gloss.ts";
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

const lookup = (word) => words.find((entry) => entry.word.toLowerCase() === word);

test("a wrong answer explains the word the child actually chose", () => {
  // Picking "debris" instead of "timid" teaches nothing about debris, and a
  // wrong answer is exactly when a child most wants to know the word they did
  // not pick, because they will meet it again.
  const options = ["timid", "debris", "flawed", "vehicle"];
  const explained = chosenWordExplanation(options, 1, "timid", lookup);
  assert.equal(explained?.word, "debris");
  assert.ok(explained?.meaning, "the chosen word must be given a meaning");
  assert.equal(
    explained?.word.toLowerCase(),
    "debris",
    "it must be the option that was chosen, not the answer",
  );
});

test("there is nothing to explain in the cases where it would be noise", () => {
  // The right answer, because there was no mistake.
  assert.equal(chosenWordExplanation(["timid", "debris"], 0, "timid", lookup), undefined);
  // A reveal, which is not a choice at all.
  assert.equal(chosenWordExplanation(["timid", "debris"], -1, "timid", lookup), undefined);
  // An option index that does not exist.
  assert.equal(chosenWordExplanation(["timid", "debris"], 7, "timid", lookup), undefined);
  // A definition question offers meanings, not words, so there is no word to
  // define. Anything with a space is a phrase the child can already read.
  assert.equal(
    chosenWordExplanation(["A means of walking", "A calm manner"], 0, "A means of walking", lookup),
    undefined,
  );
  assert.equal(
    chosenWordExplanation(["in spite of the fact that", "timid"], 0, "timid", lookup),
    undefined,
  );
  // An option that is not a word in the collection at all.
  assert.equal(chosenWordExplanation(["timid", "zzzqqq"], 1, "timid", lookup), undefined);
});

test("the explanation is given for every question type that offers words", () => {
  // def offers definitions, so nothing to gloss. The other four offer words, so
  // a wrong pick should always be explainable when it is a single word.
  for (const type of ["word", "cloze", "syn", "ant"]) {
    const problems = bankProblems.filter((problem) => problem.type === type);
    let explained = 0;
    let wrong = 0;
    for (const problem of problems.slice(0, 300)) {
      if (!problem.choices) continue;
      // The stored options are the wrong ones, with the answer kept apart, so
      // every index here is a wrong pick. That is what a child who answers
      // wrongly chose.
      for (const [index, chosen] of problem.choices.entries()) {
        if (!chosen || /\s/.test(chosen)) continue;
        wrong += 1;
        if (chosenWordExplanation(problem.choices, index, problem.answer, lookup))
          explained += 1;
      }
    }
    assert.ok(wrong > 0, `${type}: no wrong single-word options to check`);
    // Most should resolve. A word is only missing when it is a parent's own
    // addition or a phrase the collection does not hold.
    assert.ok(
      explained / wrong > 0.9,
      `${type}: only ${explained} of ${wrong} wrong single-word picks could be explained`,
    );
  }
});

test("a client can get every gloss in one go, and never for the answer", () => {
  const options = ["timid", "debris", "flawed", "in spite of the fact that"];
  const all = optionGlosses(options, "timid", lookup);
  // Never the answer, and never a phrase.
  assert.equal(all.timid, undefined);
  assert.equal(all["in spite of the fact that"], undefined);
  // Every single word that is in the collection, keyed as it was offered.
  for (const option of Object.keys(all))
    assert.ok(options.includes(option), `${option} was not offered`);
  assert.ok(Object.keys(all).length >= 2, "expected glosses for the real words");
});
