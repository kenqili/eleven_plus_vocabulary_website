/**
 * The mixed-practice game's rules.
 *
 * The question this suite answers is whether a ten-question match is actually
 * mixed and actually playable: every option list contains the answer, no word
 * is asked twice, and the type rotation covers the five practice types instead
 * of ten meanings in a row. The real bank is used as well as a small fixture,
 * because the bank is what ships.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildPracticeQuestions,
  gradePracticeAnswer,
  playableProblem,
  PRACTICE_QUESTIONS_PER_MATCH,
} from "../lib/challenge/practice-game.ts";

const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
const words = bank.words.map((row) => ({
  id: row[0],
  word: row[1],
  definition: row[2],
  example: row[3],
  syn: row[4],
  ant: row[5],
  help: row[8],
}));
const problems = bank.problems.map(([wordId, type, prompt, answer, choices]) => ({
  id: `${type}:${wordId}`,
  wordId,
  type,
  prompt,
  answer,
  choices: type === "def" ? null : choices,
  defPool: type === "def" ? choices : undefined,
}));

/** A repeatable random source, so a failing shuffle can be reproduced. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const TYPES = ["def", "syn", "ant", "word", "cloze"];

test("the real bank builds a full, mixed, answerable match", () => {
  const questions = buildPracticeQuestions({
    targets: words,
    problems,
    random: seeded(7),
  });
  assert.equal(questions.length, PRACTICE_QUESTIONS_PER_MATCH);
  assert.equal(
    new Set(questions.map((question) => question.wordId)).size,
    questions.length,
    "the same word was asked twice",
  );
  assert.deepEqual(
    [...new Set(questions.map((question) => question.type))].sort(),
    [...TYPES].sort(),
    "the match does not cover every practice type",
  );
  for (const question of questions) {
    assert.ok(TYPES.includes(question.type), `${question.type} is not a type`);
    assert.equal(question.choices.length, 4);
    assert.equal(
      new Set(question.choices).size,
      4,
      `${question.word}: a choice repeats`,
    );
    assert.ok(
      question.choices.includes(question.answer),
      `${question.word}: the answer is not among the choices`,
    );
    assert.ok(question.prompt.trim(), `${question.word}: the prompt is empty`);
    assert.ok(question.definition.trim(), `${question.word}: no definition`);
  }
});

test("a definition question with no wrong-definition pool is not playable", () => {
  assert.equal(
    playableProblem({ choices: null, defPool: undefined }),
    false,
  );
  assert.equal(playableProblem({ choices: ["a", "b", "c"], defPool: undefined }), true);
  assert.equal(playableProblem({ choices: null, defPool: ["a", "b", "c"] }), true);
});

test("a single pick is right only when it is the recorded answer", () => {
  assert.ok(gradePracticeAnswer("desert", "desert"));
  assert.ok(!gradePracticeAnswer("Desert", "desert"), "case is part of the answer");
  assert.ok(!gradePracticeAnswer("keep", "desert"));
  assert.ok(!gradePracticeAnswer(undefined, "desert"));
});

test("the rotation still fills a match when a type has no words left", () => {
  // Five words, so a ten-question match can only ask each word once. The
  // rotation must drop a type that has run out rather than spin on it.
  const vocabulary = words.slice(0, 5);
  const limited = problems.filter(
    (problem) =>
      vocabulary.some((word) => word.id === problem.wordId) &&
      problem.type !== "cloze",
  );
  const questions = buildPracticeQuestions({
    targets: vocabulary,
    problems: limited,
    random: seeded(3),
  });
  assert.equal(questions.length, 5);
  assert.equal(new Set(questions.map((question) => question.wordId)).size, 5);
  assert.ok(!questions.some((question) => question.type === "cloze"));
});
