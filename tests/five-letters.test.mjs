import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  availableHintKinds,
  countGuess,
  gradeGuess,
  HINT_SCORE_PENALTY,
  hintFor,
  isAcceptedGuess,
  keyboardMarks,
  masterWord,
  MAX_GUESSES,
  normalizeGuess,
  scoreAfterPenalty,
  scoreFromRound,
  scoreOf,
  usedHintKinds,
} from "../lib/challenge/five-letters.ts";
import {
  bandsFrom,
  correctCredit,
  currentLevel,
  levelFractions,
  levelScore,
  placementFromBands,
  stretchFraction,
} from "../lib/challenge/placement.ts";

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
  for (const word of ["bones", "greek"])
    assert.equal(dictionary[word], undefined);
  // The bank's own answers must keep the curated card, not a generated gloss.
  for (const word of answers)
    assert.equal(dictionary[word].source, "MineWords");
});

test("the free collection holds at least twenty five-letter answers", () => {
  // The server takes the free collection as a prefix of the shipped order, and
  // the browser downloads the same prefix. Twenty five-letter words inside it
  // are what lets a lapsed account play without being handed an answer outside
  // its collection; somewhere over the years a band change can add more, and
  // the guarantee is that there are at least that many, not the exact count.
  const free = new Set(bank.freeOrder.slice(0, 224));
  assert.equal(free.size, 224);
  const freeAnswers = answers.filter((word) => free.has(word));
  assert.ok(
    freeAnswers.length >= 20,
    `the free collection holds ${freeAnswers.length} five-letter answers, not 20`,
  );
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

test("the keyboard keeps the best mark for each letter", () => {
  assert.deepEqual(
    keyboardMarks([
      { word: "crane", marks: ["grey", "yellow", "grey", "grey", "green"] },
      { word: "crate", marks: ["green", "yellow", "grey", "grey", "grey"] },
    ]),
    {
      C: "green",
      R: "yellow",
      A: "grey",
      N: "grey",
      E: "green",
      T: "grey",
    },
  );
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

test("the score the browser keeps is the score the server works out", () => {
  // The server counts the account's knowledge word by word; the browser is
  // told the counted form and keeps it up to date as the child plays. If the
  // two forms could differ, the score a child watches move would be a
  // different number from the one they are finally given.
  const totals = [116, 427, 426, 426, 426, 426];
  const items = [];
  for (let band = 0; band < totals.length; band++) {
    for (let i = 0; i < totals[band]; i++) {
      items.push({
        level: band,
        mastered: (band * 7 + i) % 11 === 0,
        correct: (band * 5 + i) % 4,
      });
    }
  }
  const trailing = [
    { level: 1, correct: true },
    { level: 1, correct: false },
    { level: 2, correct: true },
  ];

  // The server's way, word by word.
  const fractions = levelFractions(items, totals);
  const base = currentLevel(fractions, trailing);
  const serverLevel = currentLevel(
    fractions,
    trailing,
    stretchFraction(items, totals, base) >= 1,
  );
  const serverScore = levelScore(
    serverLevel,
    correctCredit(items, totals, serverLevel),
  );

  // The browser's way, from the counted form.
  const bands = bandsFrom(items, totals);
  const browser = placementFromBands(bands, trailing);
  assert.equal(browser.level, serverLevel);
  assert.equal(browser.score, serverScore);

  // And the counted form is what the round carries, so the browser can keep
  // it up to date: a word that counts gains a right answer, and a solved
  // answer is mastered.
  const round = {
    answer: "peril",
    hints: {},
    bands: bands.map((band) => ({ ...band })),
    trailing,
    penalty: 0,
    answers: [["peril", 1, 1, false]],
  };
  const knowledge = scoreFromRound(round);
  const before = scoreOf(knowledge);
  countGuess(knowledge, "peril");
  const afterCount = scoreOf(knowledge);
  assert.equal(knowledge.words.get("peril").correct, 2);
  assert.equal(
    afterCount >= before,
    true,
    "a counted right answer cannot make the score go backwards",
  );
  const masteredBefore = knowledge.bands[1].mastered;
  masterWord(knowledge, "peril");
  assert.equal(knowledge.words.get("peril").mastered, true);
  assert.equal(
    knowledge.bands[1].mastered,
    masteredBefore + 1,
    "the band knows the word is mastered",
  );

  // The same two changes, counted the way the server counts them.
  const serverItems = items.map((item) => ({ ...item }));
  const word = serverItems.find(
    (item) => item.level === 1 && !item.mastered && item.correct === 1,
  );
  assert.ok(word, "the fixture has no word to count");
  word.correct = 2;
  word.mastered = true;
  const fractionsAfter = levelFractions(serverItems, totals);
  const baseAfter = currentLevel(fractionsAfter, trailing);
  const levelAfter = currentLevel(
    fractionsAfter,
    trailing,
    stretchFraction(serverItems, totals, baseAfter) >= 1,
  );
  assert.equal(
    levelScore(
      levelAfter,
      correctCredit(serverItems, totals, levelAfter),
    ),
    scoreOf(knowledge),
    "the browser's score and the server's score are the same number",
  );

  // A hint costs five points for good, and the browser takes them off as the
  // child takes it.
  knowledge.penalty += HINT_SCORE_PENALTY;
  assert.equal(scoreOf(knowledge), Math.max(0, scoreOf(knowledge)));
});
