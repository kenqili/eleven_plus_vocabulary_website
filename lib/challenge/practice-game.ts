import { choicesForProblem, type Problem } from "./bank.ts";
import { QUESTION_TYPES, type QuestionType } from "./config.ts";
import { splitRelations, type RelationWord } from "./relations.ts";
import { shuffle } from "./words.ts";

/**
 * The mixed-practice game: ten questions of every practice type.
 *
 * It is the practice screen with a finish line. The questions are the bank's
 * own problems - the same ones `/practice` serves - so a child who plays this
 * is revising exactly what they practise, not a second, easier set invented
 * for the game. Ten is a sitting rather than a session.
 *
 * The types are rotated instead of drawn freely. Drawing ten questions at
 * random from a pool that is four-fifths meanings gives a match of ten
 * meanings and calls it mixed; rotating guarantees that a ten-question match
 * covers the five types twice when they are all available.
 */

export const PRACTICE_QUESTIONS_PER_MATCH = 10;

/** One question of the mixed game, with everything the reveal shows. */
export type PracticeGameQuestion = {
  id: string;
  wordId: string;
  word: string;
  type: QuestionType;
  prompt: string;
  /** Four options, the right one among them. */
  choices: string[];
  answer: string;
  definition: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
};

/**
 * Whether a problem can be shown at all.
 *
 * A definition question carries a pool of wrong definitions rather than a
 * fixed list, and a parent's own word is generated without that pool. Asking
 * one would throw while building the options, so it is not a question this
 * game can play.
 */
export function playableProblem(problem: Problem): boolean {
  const pool = problem.choices ?? problem.defPool ?? [];
  return pool.length >= 3;
}

export function buildPracticeQuestions(input: {
  targets: readonly RelationWord[];
  problems: readonly Problem[];
  count?: number;
  random?: () => number;
}): PracticeGameQuestion[] {
  const {
    targets,
    problems,
    count = PRACTICE_QUESTIONS_PER_MATCH,
    random = Math.random,
  } = input;

  const targetById = new Map(targets.map((word) => [word.id, word]));
  const byType = new Map<QuestionType, Problem[]>();
  for (const problem of problems) {
    if (!targetById.has(problem.wordId) || !playableProblem(problem)) continue;
    const list = byType.get(problem.type) ?? [];
    list.push(problem);
    byType.set(problem.type, list);
  }

  const types = shuffle(
    QUESTION_TYPES.filter((type) => byType.get(type)?.length),
    random,
  );
  const usedWords = new Set<string>();
  const questions: PracticeGameQuestion[] = [];
  let cursor = 0;
  while (questions.length < count && types.length) {
    const type = types[cursor % types.length];
    const candidates = (byType.get(type) ?? []).filter(
      (problem) => !usedWords.has(problem.wordId),
    );
    if (!candidates.length) {
      // This type has no word left that has not been asked. Drop it and start
      // the rotation again on the types that remain.
      types.splice(types.indexOf(type), 1);
      cursor = 0;
      continue;
    }
    const problem = candidates[Math.floor(random() * candidates.length)];
    const word = targetById.get(problem.wordId)!;
    usedWords.add(word.id);
    questions.push({
      id: problem.id,
      wordId: word.id,
      word: word.word,
      type: problem.type,
      prompt: problem.prompt,
      choices: choicesForProblem(problem, random),
      answer: problem.answer,
      definition: (word.help || word.definition).trim(),
      example: (word.example ?? "").trim(),
      synonyms: splitRelations(word.syn),
      antonyms: splitRelations(word.ant),
    });
    cursor++;
  }
  return questions;
}

/** Whether a single pick is the answer the bank records. */
export function gradePracticeAnswer(
  selected: unknown,
  answer: string,
): boolean {
  return typeof selected === "string" && selected === answer;
}
