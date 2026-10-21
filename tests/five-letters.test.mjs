import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  availableHintKinds,
  gradeGuess,
  HINT_SCORE_PENALTY,
  hintFor,
  isAcceptedGuess,
  MAX_GUESSES,
  normalizeGuess,
  scoreAfterPenalty,
  usedHintKinds,
} from "../lib/challenge/five-letters.ts";

const accepted = JSON.parse(
  readFileSync("data/five-letters/accepted.json", "utf8"),
);
const dictionary = JSON.parse(
  readFileSync("data/five-letters/dictionary.json", "utf8"),
);
const published = JSON.parse(
  readFileSync("public/five-letters/dictionary.json", "utf8"),
);
const valid = readFileSync("data/five-letters/valid-guesses.txt", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const blocklist = new Set(
  readFileSync("data/five-letters/blocklist.txt", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);
const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
const answers = bank.words
  .filter((row) => String(row[1]).length === 5)
  .map((row) => String(row[1]).toLowerCase())
  .sort();

test("the accepted list is the full valid-guess list minus the blocklist", () => {
  const expected = [...new Set([...valid, ...answers])]
    .filter((word) => !blocklist.has(word))
    .sort();
  assert.deepEqual(accepted, expected);
  assert.equal(accepted.length, 14818);
  assert.equal(new Set(accepted).size, accepted.length);
  assert.deepEqual([...accepted].sort(), accepted, "accepted.json is sorted");
  for (const word of accepted)
    assert.match(word, /^[a-z]{5}$/, `not a five-letter word: ${word}`);
  assert.equal(answers.length, 194);
  for (const word of [
    "atlas",
    "doyen",
    "jaded",
    "matte",
    "muted",
    "odour",
    "pious",
    "sated",
  ])
    assert.ok(accepted.includes(word), `missing bank answer: ${word}`);
  for (const word of answers)
    assert.ok(accepted.includes(word), `bank answer not accepted: ${word}`);
  for (const word of ["bones", "greek", "years", "games"])
    assert.ok(accepted.includes(word), `missing common guess: ${word}`);
});

test("every carded word has a complete card, and the public copy is current", () => {
  assert.deepEqual(published, dictionary);
  assert.equal(Object.keys(dictionary).length, 2323);
  for (const word of Object.keys(dictionary)) {
    assert.ok(accepted.includes(word), `card for unaccepted word ${word}`);
    const card = dictionary[word];
    assert.ok(card, `no card for ${word}`);
    assert.equal(typeof card.definition, "string");
    assert.ok(card.definition.trim(), `empty definition for ${word}`);
    assert.equal(typeof card.example, "string");
    assert.ok(Array.isArray(card.synonyms), `synonyms for ${word}`);
    assert.ok(Array.isArray(card.antonyms), `antonyms for ${word}`);
    assert.ok(
      card.source === "MineWords" || card.source === "WordNet 3.0",
      `source for ${word}`,
    );
  }
  // A valid guess outside the vocabulary is accepted without a card.
  for (const word of ["bones", "greek"]) assert.equal(dictionary[word], undefined);
  // The bank's own answers must keep the curated card, not a generated gloss.
  for (const word of answers)
    assert.equal(dictionary[word].source, "MineWords");
});

test("the free collection holds the twenty five-letter answers", () => {
  // The server takes the free collection as a prefix of the shipped order, and
  // the browser downloads the same prefix. Keeping twenty five-letter words
  // inside it is what lets a lapsed account play without being handed an answer
  // outside its collection.
  const free = new Set(bank.freeOrder.slice(0, 224));
  assert.equal(free.size, 224);
  const freeAnswers = answers.filter((word) => free.has(word));
  assert.equal(freeAnswers.length, 20);
  for (const word of freeAnswers) assert.ok(isAcceptedGuess(word));
});

test("the bank answers are a strict five-letter game pool", () => {
  assert.equal(answers.length, 194);
  const longer = bank.words.filter((row) => String(row[1]).length !== 5);
  assert.ok(longer.length > 0, "the bank should contain non-five-letter words");
  for (const word of answers) {
    assert.equal(word.length, 5);
    assert.ok(isAcceptedGuess(word));
  }
  assert.equal(MAX_GUESSES, 6);
  assert.equal(HINT_SCORE_PENALTY, 5);
});

test("guesses are normalised and validated", () => {
  assert.equal(normalizeGuess("  CRANE "), "crane");
  assert.equal(normalizeGuess("crane"), "crane");
  assert.equal(normalizeGuess("four"), null);
  assert.equal(normalizeGuess("sixsix"), null);
  assert.equal(normalizeGuess("cr4ne"), null);
  assert.equal(normalizeGuess(""), null);
  assert.ok(isAcceptedGuess("crane"));
  assert.ok(isAcceptedGuess("bones"));
  assert.ok(isAcceptedGuess("greek"));
  assert.equal(isAcceptedGuess("bitch"), false);
  assert.equal(isAcceptedGuess("zzzzz"), false);
});

test("grading handles greens, yellows, repeats and absent letters", () => {
  assert.deepEqual(gradeGuess("crane", "crane"), [
    "green",
    "green",
    "green",
    "green",
    "green",
  ]);
  // The second b in the guess is grey because the answer has only two, and the
  // first two were already matched.
  assert.deepEqual(gradeGuess("abbey", "bbbbb"), [
    "grey",
    "green",
    "green",
    "grey",
    "grey",
  ]);
  // One earlier b is a yellow, the later duplicate is grey.
  assert.deepEqual(gradeGuess("abbey", "bobby"), [
    "yellow",
    "grey",
    "green",
    "grey",
    "green",
  ]);
  assert.deepEqual(gradeGuess("crane", "nacre"), [
    "yellow",
    "yellow",
    "yellow",
    "yellow",
    "green",
  ]);
  assert.throws(() => gradeGuess("crane", "four"));
  assert.throws(() => gradeGuess("four", "crane"));
});

test("hints are deterministic, hide the answer and cost five points", () => {
  const card = {
    definition: "a test word",
    example: "",
    synonyms: ["happy", "glad", "cheerful"],
    antonyms: ["sad", "unhappy"],
    source: "MineWords",
  };
  assert.equal(hintFor(card, "syn", "glad"), "happy");
  assert.equal(hintFor(card, "ant", "glad"), "sad");
  assert.equal(hintFor(card, "syn", "glad"), hintFor(card, "syn", "glad"));
  assert.deepEqual(availableHintKinds(card, "glad"), ["syn", "ant"]);
  assert.equal(usedHintKinds("syn,ant,unknown,syn").join(","), "syn,ant,syn");
  assert.deepEqual(usedHintKinds(""), []);
  assert.equal(scoreAfterPenalty(10000, 5), 9995);
  assert.equal(scoreAfterPenalty(3, 5), 0);
  assert.equal(scoreAfterPenalty(10000, 0), 10000);
});

test("a missing relation is not offered", () => {
  const card = {
    definition: "a test word",
    example: "",
    synonyms: [],
    antonyms: [],
    source: "MineWords",
  };
  assert.equal(hintFor(card, "syn", "test"), null);
  assert.equal(hintFor(card, "ant", "test"), null);
  assert.deepEqual(availableHintKinds(card, "test"), []);
});
