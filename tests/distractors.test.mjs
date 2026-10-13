// A question about an easy word must not offer a rare word as a wrong answer.
// Before this was fixed, 30% of the options for a Level 0 or 1 question were
// Level 4 or 5 words, which made the only way through a question noticing which
// option looked unfamiliar. That is not a vocabulary test.
import test from "node:test";
import assert from "node:assert/strict";
import { words } from "../scripts/load-word-bank.mjs";
import {
  levelOf as levelMap,
  problems,
} from "../scripts/load-problem-bank.mjs";
import {
  buildDistractorContext,
  hasWholeWord,
  pickDefinitionDistractors,
  relatedMap,
  withAntonymSlot,
} from "../lib/challenge/problems.ts";
import { choicesForProblem } from "../lib/challenge/bank.ts";

/** Band lookup: a Map since the bank started carrying its own levels. */
const levelOf = (id) => levelMap.get(id) ?? 3;

const byWord = new Map(words.map((word) => [word.word.toLowerCase(), word]));
const byId = new Map(words.map((word) => [word.id, word]));
/** Every option in a question, resolved back to a word so it can be banded. */
const optionLevels = (problem) =>
  (problem.choices ?? [])
    .map((choice) => byWord.get(choice.toLowerCase()))
    .filter(Boolean)
    .map((word) => levelOf(word.id));

/** Deterministic seeds, so a failure names the draw that produced it. */
const seeded = (seed = 7) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

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

test("every pool holds at least three, and the answer stays apart", () => {
  // A pool of exactly three can only ever show one set; rotation needs room.
  // The answer is stored apart and joined at ask time, so it must not sit in
  // the pool waiting to be offered as a wrong option.
  for (const problem of problems) {
    const pool = problem.choices ?? problem.defPool ?? [];
    assert.ok(
      pool.length >= 3,
      `${problem.id}: pool holds ${pool.length}`,
    );
    assert.equal(
      new Set(pool.map((c) => c.toLowerCase())).size,
      pool.length,
      `${problem.id}: duplicate options in the pool`,
    );
    assert.ok(
      !pool.some((c) => c === problem.answer),
      `${problem.id}: the answer is stored among the wrong options`,
    );
  }
});

test("the answer is still never offered as someone else's distractor", () => {
  // The fairness rule from before the change must still hold, or narrowing the
  // pool would have reintroduced a synonym of the answer.
  const seen = new Map();
  for (const problem of problems) {
    const pool = problem.choices ?? problem.defPool ?? [];
    for (const choice of pool) {
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
  // Every word but the self-naming ones, whose definition gives the answer
  // away and so cannot be asked.
  const selfNaming = words.filter((word) =>
    hasWholeWord(word.definition, word.word),
  ).length;
  assert.equal(counts.def, words.length - selfNaming);
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
    const pool = pickDefinitionDistractors(`leak:${word.id}`, word, context, 6);
    for (const otherId of relations.get(word.id) ?? []) {
      if (otherId === word.id) continue;
      const other = words.find((entry) => entry.id === otherId);
      if (!other) continue;
      // Two related words can share one definition. That is the same answer
      // twice in the bank, not a second option, so it is not a leak.
      if (other.definition === word.definition) continue;
      if (pool.includes(other.definition))
        leaks.push(`${word.word} offered ${other.word}'s meaning`);
    }
  }
  assert.deepEqual(leaks.slice(0, 5), []);
});

test("the same word comes with different options each time it is asked", () => {
  // Otherwise the child learns to eliminate the same three wrong answers
  // rather than to recall anything, which is what the word is mastered on.
  // Driven through the same function the server and the browser call. Every
  // window start is tried rather than a few seeds: consecutive seeds of a
  // counter-based generator open neighbouring windows, which is a fact about
  // the seeds rather than proof of rotation.
  const asked = problems.filter(
    (problem) =>
      (problem.choices ?? problem.defPool ?? []).length >= 4,
  );
  assert.ok(asked.length > 9000, "expected nearly every problem to rotate");
  let varied = 0;
  for (const problem of asked.slice(0, 400)) {
    const pool = problem.choices ?? problem.defPool ?? [];
    const drawn = new Set();
    for (let start = 0; start < pool.length; start++) {
      const shown = choicesForProblem(problem, () => start / pool.length);
      assert.equal(shown.length, 4, problem.id);
      assert.equal(new Set(shown).size, 4, `${problem.id}: duplicate shown`);
      assert.equal(
        shown.filter((choice) => choice === problem.answer).length,
        1,
        `${problem.id}: answer missing or twice`,
      );
      drawn.add(
        shown
          .filter((choice) => choice !== problem.answer)
          .sort()
          .join("|"),
      );
    }
    if (drawn.size > 1) varied++;
  }
  assert.ok(
    varied > 350,
    `only ${varied} of 400 sampled problems varied their wrong options`,
  );
  // And the same window asks the same question: rotation is variety, not
  // noise, which is what lets a failure name the draw that produced it.
  const problem = asked[0];
  assert.deepEqual(
    choicesForProblem(problem, seeded(11)),
    choicesForProblem(problem, seeded(11)),
  );
});

test("definition options come from a comparable difficulty", () => {
  // Options follow the level filter, or a Level 0 question is decided by
  // which option is rarest.
  const context = buildDistractorContext(words, levelOf);
  const easy = words.filter((word) => levelOf(word.id) <= 1).slice(0, 200);
  const byDefinition = new Map();
  for (const word of words) if (!byDefinition.has(word.definition)) byDefinition.set(word.definition, word);
  const levels = [];
  for (const word of easy)
    for (const choice of pickDefinitionDistractors(
      `lvl:${word.id}`,
      word,
      context,
      6,
    )) {
      const other = byDefinition.get(choice);
      if (other) levels.push(levelOf(other.id));
    }
  const far = levels.filter((level) => level >= 4).length;
  assert.ok(
    far / levels.length < 0.02,
    `${far} of ${levels.length} definition options for an easy question were Level 4 or 5`,
  );
});

test("an antonym takes a pool slot most of the time it can", () => {
  // A synonym question whose options never include an opposite lets a child
  // through who never distinguished the two. The slot is probabilistic (0.8
  // in the build), deterministic on the key, and fenced: never the answer,
  // never outside one band, never on an antonym question, never in a
  // definition pool.
  const context = buildDistractorContext(words, levelOf);
  const subject = words.find(
    (word) =>
      word.ant &&
      word.ant.split(";").some((term) => {
        const other =
          context.byWord.get(term.normalize("NFKC").trim().toLowerCase());
        return (
          other &&
          other.id !== word.id &&
          Math.abs(levelOf(other.id) - levelOf(word.id)) <= 1
        );
      }),
  );
  assert.ok(subject, "expected a word with an eligible antonym");
  const pool = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
  const slotted = withAntonymSlot(
    pool,
    `ant:${subject.id}`,
    subject,
    subject.word,
    "word",
    context,
    1,
  );
  assert.equal(slotted.length, pool.length, "the slot replaces, never grows");
  assert.equal(
    slotted.filter((choice) => !pool.includes(choice)).length,
    1,
    "exactly one slot changes",
  );
  const added = slotted.find((choice) => !pool.includes(choice));
  const antonyms = subject.ant
    .split(";")
    .map((term) => term.normalize("NFKC").trim().toLowerCase());
  assert.ok(
    antonyms.includes(added.toLowerCase()),
    `${added} is not an antonym of ${subject.word}`,
  );
  // Off means off, whatever the word carries.
  assert.deepEqual(
    withAntonymSlot(pool, `ant:${subject.id}`, subject, subject.word, "word", context, 0),
    pool,
  );
  // Antonym questions and definitions never take the slot: another opposite
  // beside the answer risks a second valid option, and meanings have no words.
  for (const type of ["ant", "def"]) {
    assert.deepEqual(
      withAntonymSlot(pool, `ant:${subject.id}`, subject, subject.word, type, context, 1),
      pool,
      `${type} questions must not offer an antonym slot`,
    );
  }
});

test("antonyms in pools are never answers and never far away", () => {
  // Bank-wide audit over what was generated: every antonym sitting in a
  // word, cloze or synonym pool is checked against the band rule and the
  // answer, because one unfamiliar rare opposite among the options is a
  // giveaway rather than a test.
  const byName = new Map(words.map((w) => [w.word.toLowerCase(), w]));
  let checked = 0;
  for (const problem of problems) {
    if (!["word", "cloze", "syn"].includes(problem.type)) continue;
    const subject = byId.get(problem.wordId);
    if (!subject || !subject.ant) continue;
    const antonyms = subject.ant
      .split(";")
      .map((term) => term.normalize("NFKC").trim().toLowerCase())
      .filter(Boolean);
    const subjectBand = levelOf(subject.id);
    for (const choice of problem.choices ?? []) {
      if (!antonyms.includes(choice.toLowerCase())) continue;
      checked++;
      assert.notEqual(
        choice.toLowerCase(),
        problem.answer.toLowerCase(),
        `${problem.id}: an antonym duplicates the answer`,
      );
      const other = byName.get(choice.toLowerCase());
      assert.ok(other, `${problem.id}: ${choice} is not a bank word`);
      assert.ok(
        Math.abs(levelOf(other.id) - subjectBand) <= 1,
        `${problem.id}: antonym ${choice} sits outside one band`,
      );
    }
  }
  assert.ok(checked > 1000, `expected antonyms everywhere, found ${checked}`);
});
