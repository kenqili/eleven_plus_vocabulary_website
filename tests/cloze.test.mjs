// The word and cloze question types ask for the word itself, so they carry
// rules the other types do not: the prompt must never contain the answer, and
// no option may be related to the answer.
import test from "node:test";
import assert from "node:assert/strict";
import {
  blankExample,
  hasWholeWord,
  inflectionsOf,
  pickDistractors,
  buildDistractorContext,
  CLOZE_BLANK,
  CHOICES_PER_PROBLEM,
} from "../lib/challenge/problems.ts";
import { problems } from "../scripts/load-problem-bank.mjs";
import { words } from "../scripts/load-word-bank.mjs";

const byId = new Map(words.map((word) => [word.id, word]));
const relationTerms = (value) =>
  value
    .split(";")
    .map((x) => x.trim().toLowerCase())
    // A lone dash is the "no relation" placeholder, not a relation.
    .filter((x) => x && !/^[—–-]$/.test(x));
/**
 * A word is related to another if either names the other as a relation.
 * The snapshot per word matters: growing a set while iterating it would
 * invent transitive relations that no word actually declares.
 */
const related = new Map(
  words.map((word) => [
    word.id,
    new Set([word.id, ...relationTerms(word.syn), ...relationTerms(word.ant)]),
  ]),
);
for (const word of words) {
  const declared = [...related.get(word.id)];
  for (const other of words) {
    if (declared.some((term) =>
      relationTerms(other.syn).includes(term) || relationTerms(other.ant).includes(term)))
      related.get(word.id).add(other.id);
  }
}

test("inflections cover the forms a sentence is likely to use", () => {
  const forms = inflectionsOf("abandon");
  for (const form of ["abandon", "abandons", "abandoned", "abandoning"]) {
    assert.ok(forms.includes(form), `missing ${form}`);
  }
  assert.ok(inflectionsOf("try").includes("tried"));
  assert.ok(inflectionsOf("try").includes("trying"));
  assert.ok(inflectionsOf("carry").includes("carried"));
  assert.ok(inflectionsOf("carry").includes("carrying"));
  assert.ok(inflectionsOf("happy").includes("happiness") === false);
});

test("blankExample replaces the word or an inflection, and refuses when absent", () => {
  assert.equal(
    blankExample("The sailors had to abandon the damaged ship.", "abandon"),
    `The sailors had to ${CLOZE_BLANK} the damaged ship.`,
  );
  assert.equal(
    blankExample("She began to covet her friend's lifestyle.", "covet"),
    `She began to ${CLOZE_BLANK} her friend's lifestyle.`,
  );
  assert.equal(blankExample("Nothing relevant here.", "abandon"), null);
  // A partial match must not be blanked: "art" is not a word inside "start".
  assert.equal(blankExample("They start early.", "art"), null);
  assert.ok(hasWholeWord("today's art lesson", "art"));
  assert.ok(!hasWholeWord("the artist arrived", "art"));
  assert.ok(!hasWholeWord("the start of term", "art"));
});

test("word questions never show the answer, and offer four distinct options", () => {
  const wordProblems = problems.filter((p) => p.type === "word");
  assert.ok(wordProblems.length > words.length * 0.99, "most words should have one");
  for (const problem of wordProblems) {
    const word = byId.get(problem.wordId);
    assert.equal(problem.answer, word.word, problem.id);
    assert.ok(
      !hasWholeWord(problem.prompt, word.word),
      `${problem.id}: the prompt must not contain the answer`,
    );
    assert.equal(problem.choices.length, CHOICES_PER_PROBLEM, problem.id);
    assert.equal(
      new Set(problem.choices.map((c) => c.toLowerCase())).size,
      CHOICES_PER_PROBLEM,
      `${problem.id}: options must be distinct`,
    );
    assert.equal(
      problem.choices.filter((c) => c === problem.answer).length,
      1,
      `${problem.id}: exactly one option is the answer`,
    );
  }
});

test("cloze questions blank the word and never offer a related option", () => {
  const clozeProblems = problems.filter((p) => p.type === "cloze");
  assert.ok(clozeProblems.length > 0);
  for (const problem of clozeProblems) {
    const word = byId.get(problem.wordId);
    assert.ok(problem.prompt.includes(CLOZE_BLANK), problem.id);
    assert.ok(
      !hasWholeWord(problem.prompt, word.word),
      `${problem.id}: the blanked sentence must not still contain the answer`,
    );
    assert.equal(problem.choices.length, CHOICES_PER_PROBLEM, problem.id);
    for (const choice of problem.choices) {
      if (choice.toLowerCase() === problem.answer.toLowerCase()) continue;
      assert.ok(
        !related.get(word.id).has(choice.toLowerCase()),
        `${problem.id}: option "${choice}" is a relation of "${problem.answer}"`,
      );
    }
  }
});

test("distractors are stable for the same word and avoid the answer's relations", () => {
  const context = buildDistractorContext(words);
  const word = byId.get("abandon");
  const first = pickDistractors("cloze:abandon", word, word.word, context);
  const second = pickDistractors("cloze:abandon", word, word.word, context);
  assert.deepEqual(first, second, "the same word must always get the same options");
  for (const choice of first) {
    assert.ok(!related.get("abandon").has(choice.toLowerCase()), choice);
  }
  // A different question type for the same word may differ, but must stay clean.
  const other = pickDistractors("word:abandon", word, word.word, context);
  for (const choice of other) {
    assert.ok(!related.get("abandon").has(choice.toLowerCase()), choice);
  }
});

test("no cloze question leaves any form of its own answer in the gap", () => {
  // A sentence that used the word twice used to leave the second one in plain
  // sight, and where the plural came first the base form was the one left
  // unblanked, so the answer could be read straight out of the question.
  const byId = new Map(words.map((word) => [word.id, word]));
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leaks = [];
  for (const problem of problems) {
    if (problem.type !== "cloze") continue;
    const word = byId.get(problem.wordId);
    if (!word) continue;
    for (const form of inflectionsOf(word.word)) {
      // Very short forms produce false positives against ordinary text.
      if (form.length < 3) continue;
      if (new RegExp(`\\b${escaped(form)}\\b`, "i").test(problem.prompt)) {
        leaks.push(`${problem.id}: ${problem.prompt}`);
        break;
      }
    }
  }
  assert.deepEqual(leaks.slice(0, 5), [], "cloze questions that give away the answer");
});

test("a word used twice in one sentence gets a gap in both places", () => {
  const twice = blankExample(
    "The poem had three stanzas; each stanza contained four lines.",
    "stanza",
  );
  assert.equal(
    twice?.split(CLOZE_BLANK).length - 1,
    2,
    "both occurrences must be blanked",
  );
  assert.ok(!/stanza/i.test(twice ?? ""), "no form may survive");
});

test("blanking keeps the sentence readable", () => {
  const out = blankExample("She walked slowly towards the gates.", "walk");
  assert.equal(out, `She ${CLOZE_BLANK} slowly towards the gates.`);
  // A word that is not there yields no question rather than an invented one.
  assert.equal(blankExample("Nothing here matches.", "quaff"), null);
});
