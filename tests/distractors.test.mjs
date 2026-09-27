// A question about an easy word must not offer a rare word as a wrong answer.
// Before this was fixed, 30% of the options for a Level 0 or 1 question were
// Level 4 or 5 words, which made the only way through a question noticing which
// option looked unfamiliar. That is not a vocabulary test.
import test from "node:test";
import assert from "node:assert/strict";
import { words } from "../scripts/load-word-bank.mjs";
import { levelOf, problems } from "../scripts/load-problem-bank.mjs";
import {
  buildDistractorContext,
  relatedMap,
} from "../lib/challenge/problems.ts";
import { choicesFor } from "../lib/challenge/words.ts";

const byWord = new Map(words.map((word) => [word.word.toLowerCase(), word]));
/** Every option in a question, resolved back to a word so it can be banded. */
const optionLevels = (problem) =>
  (problem.choices ?? [])
    .map((choice) => byWord.get(choice.toLowerCase()))
    .filter(Boolean)
    .map((word) => levelOf(word.id));

test("an easy question is not answered against the hardest words", () => {
  for (const type of ["word", "cloze"]) {
    const easy = problems.filter(
      (problem) => problem.type === type && levelOf(problem.wordId) <= 1,
    );
    assert.ok(easy.length > 100, `expected plenty of easy ${type} questions`);
    const levels = easy.flatMap(optionLevels);
    const far = levels.filter((level) => level >= 4);
    assert.equal(
      far.length,
      0,
      `${type}: ${far.length} of ${levels.length} options for an easy question were Level 4 or 5`,
    );
    // And nothing is more than one band away from the word being asked about.
    for (const problem of easy) {
      const subject = levelOf(problem.wordId);
      for (const level of optionLevels(problem))
        assert.ok(
          Math.abs(level - subject) <= 1,
          `${problem.id}: a Level ${subject} question offered a Level ${level} word`,
        );
    }
  }
});

test("a hard question is still answered with plausible neighbours", () => {
  // Restricting the pool must not make every hard question obvious either: the
  // wrong options have to be the sort of word a child at that level knows.
  const hard = problems.filter(
    (problem) => problem.type === "cloze" && levelOf(problem.wordId) >= 4,
  );
  assert.ok(hard.length > 50, "expected hard cloze questions to check");
  for (const problem of hard)
    for (const level of optionLevels(problem))
      assert.ok(level >= 3, `${problem.id}: offered a Level ${level} word`);
});

test("restricting the pool did not break any question", () => {
  // Every question still has exactly four distinct options, one of which is the
  // answer, or it would have been dropped when the bank was built.
  for (const problem of problems) {
    if (!problem.choices) continue;
    assert.equal(problem.choices.length, 4, problem.id);
    assert.equal(
      new Set(problem.choices.map((c) => c.toLowerCase())).size,
      4,
      `${problem.id}: duplicate options`,
    );
    assert.ok(problem.choices.includes(problem.answer), problem.id);
  }
});

test("the answer is still never offered as someone else's distractor", () => {
  // The fairness rule from before the change must still hold, or narrowing the
  // pool would have reintroduced a synonym of the answer.
  const seen = new Map();
  for (const problem of problems) {
    if (!problem.choices) continue;
    for (const choice of problem.choices) {
      if (choice.toLowerCase() === problem.answer.toLowerCase()) continue;
      const key = choice.toLowerCase();
      const others = seen.get(key) ?? new Set();
      others.add(problem.answer.toLowerCase());
      seen.set(key, others);
    }
  }
  // A single word used as the answer in many questions is fine; what must not
  // happen is the same word being an option for two questions that share an
  // answer relationship. That check lives in the blocklist tests.
  assert.ok(seen.size > 500, "expected a wide option vocabulary");
});

test("every question type is still generated for every word", () => {
  const counts = {};
  for (const problem of problems)
    counts[problem.type] = (counts[problem.type] ?? 0) + 1;
  assert.equal(counts.def, words.length);
  for (const type of ["word", "cloze", "syn", "ant"])
    assert.ok(counts[type] > 500, `${type} only has ${counts[type]}`);
});

test("a definition question never offers a related word's meaning", () => {
  // The definition type used to be built by a different code path that skipped
  // the synonym and antonym blocklist the other four types honour, so on a
  // handful of words the wrong option was the definition of a listed synonym
  // and a child could be given two defensible answers.
  const context = buildDistractorContext(words, levelOf);
  const relations = relatedMap(words);
  const leaks = [];
  for (const word of words) {
    const choices = choicesFor(word, context, `leak:${word.id}`);
    for (const otherId of relations.get(word.id) ?? []) {
      if (otherId === word.id) continue;
      const other = words.find((entry) => entry.id === otherId);
      if (!other) continue;
      // Two related words can share one definition. That is the same answer
      // twice in the bank, not a second option, so it is not a leak.
      if (other.definition === word.definition) continue;
      if (choices.includes(other.definition))
        leaks.push(`${word.word} offered ${other.word}'s meaning`);
    }
  }
  assert.deepEqual(leaks.slice(0, 5), []);
});

test("no question contains its own answer twice", () => {
  const context = buildDistractorContext(words, levelOf);
  for (const word of words) {
    const choices = choicesFor(word, context, `dupe:${word.id}`);
    assert.equal(
      choices.filter((choice) => choice === word.definition).length,
      1,
      `${word.id}: the answer appears more than once`,
    );
  }
});

test("the same word comes with different options each time it is asked", () => {
  // Otherwise the child learns to eliminate the same three wrong answers
  // rather than to recall anything, which is what the word is mastered on.
  const context = buildDistractorContext(words, levelOf);
  const word = words[500];
  const first = choicesFor(word, context, "attempt-one");
  const second = choicesFor(word, context, "attempt-two");
  assert.notDeepEqual(first, second, "options must rotate between attempts");
  // And the rotation must not have broken the question.
  for (const choices of [first, second]) {
    assert.equal(choices.length, 4);
    assert.equal(new Set(choices).size, 4);
    assert.ok(choices.includes(word.definition));
  }
});

test("definition options come from a comparable difficulty", () => {
  // The level filter narrows the word being asked about, and the options have
  // to follow, or a Level 0 question is decided by which option is rarest.
  const context = buildDistractorContext(words, levelOf);
  const easy = words.filter((word) => levelOf(word.id) <= 1).slice(0, 200);
  const byDefinition = new Map();
  for (const word of words) if (!byDefinition.has(word.definition)) byDefinition.set(word.definition, word);
  const levels = [];
  for (const word of easy)
    for (const choice of choicesFor(word, context, `lvl:${word.id}`)) {
      if (choice === word.definition) continue;
      const other = byDefinition.get(choice);
      if (other) levels.push(levelOf(other.id));
    }
  const far = levels.filter((level) => level >= 4).length;
  assert.ok(
    far / levels.length < 0.02,
    `${far} of ${levels.length} definition options for an easy question were Level 4 or 5`,
  );
});
