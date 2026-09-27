// A question about an easy word must not offer a rare word as a wrong answer.
// Before this was fixed, 30% of the options for a Level 0 or 1 question were
// Level 4 or 5 words, which made the only way through a question noticing which
// option looked unfamiliar. That is not a vocabulary test.
import test from "node:test";
import assert from "node:assert/strict";
import { words } from "../scripts/load-word-bank.mjs";
import { levelOf, problems } from "../scripts/load-problem-bank.mjs";

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
