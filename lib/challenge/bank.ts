import bank from "../../data/problem-bank.json" with { type: "json" };
import { shuffle, type Word } from "./words.ts";
import type { QuestionType } from "./config.ts";

/**
 * The whole question bank, loaded from a file generated at build time.
 *
 * It used to be built here, every time this module loaded, from the word list
 * and two question CSVs. That cost 1.3 seconds of compute and about 70 MB
 * resident, for data that has never changed and cannot change without a
 * redeploy. Building it in a build step instead takes it off the request path
 * completely.
 *
 * That matters more than the clock. On Cloudflare Workers the first request on
 * a cold isolate pays for evaluating every module it touches, so a module that
 * takes over a second to initialise puts a plan with a ten millisecond budget
 * permanently out of reach no matter how fast the request itself is.
 *
 * Everything the app asked of this module before, it still provides, so no
 * caller had to change: the words, the questions, and a lookup by id.
 */

/** Options per question. Fixed at generation time and checked on load. */
export const CHOICES_PER_PROBLEM: number = bank.meta.choicesPerProblem;

/** Wrong definitions kept per word, so a repeat can be shown differently. */
const DEF_POOL: number = bank.meta.definitionPool;

type WordRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  Word["source"],
];

const rowToWord = ([
  id,
  word,
  definition,
  example,
  syn,
  ant,
  ,
  source,
]: WordRow): Word => ({
  id,
  word,
  definition,
  example: example || "",
  syn: syn || "",
  ant: ant || "",
  source,
});

export const words = (bank.words as WordRow[]).map(rowToWord);

/**
 * The difficulty band of every bank word.
 *
 * This was a separate 336 KB snapshot that the request path loaded to answer one
 * question, when every word row already carries its own level. It is here now
 * so the whole request path is one file and one parse.
 */
export const levelOf = new Map<string, number>(bank.levels as [string, number][]);

/**
 * Words by id, so the request path never scans for one. Added rather than
 * replacing the array because callers want both the list and the lookup.
 */
const wordsById = new Map(words.map((word) => [word.id, word]));
export const wordById = (id: string) => wordsById.get(id);

type ProblemRow = [string, QuestionType, string, string, string[]];

/**
 * One question, as the rest of the app sees it.
 *
 * Declared here rather than imported, because the shape this file produces is
 * not the same as the shape the generator produces: a definition question
 * carries a pool of wrong options instead of a fixed three, and only the
 * request path knows which to use.
 */
export type Problem = {
  id: string;
  wordId: string;
  type: QuestionType;
  prompt: string;
  answer: string;
  /** Fixed wrong options. Null for a definition question, which uses defPool. */
  choices: string[] | null;
  /** Wrong definitions to draw from, for a definition question only. */
  defPool?: string[];
};

/**
 * The questions, as the rest of the app expects them.
 *
 * A definition question's wrong options are a pool rather than a fixed three,
 * so the request path can shuffle and take three. That is the one thing this
 * module does at request time, and it costs a shuffle of a short array.
 */
export const problems: Problem[] = (bank.problems as ProblemRow[]).map(
  ([wordId, type, prompt, answer, choices]) => ({
    id: `${type}:${wordId}`,
    wordId,
    type,
    prompt,
    answer,
    choices: type === "def" ? null : choices,
    // Kept beside the record rather than looked up, so serving a definition
    // question is one array read and not a map probe.
    defPool: type === "def" ? choices : undefined,
  }),
);

export const problemById = new Map(
  problems.map((problem) => [problem.id, problem]),
);

/** Every question type, and how many of each, for the build check. */
export const problemCounts = problems.reduce<Record<string, number>>(
  (counts, problem) => {
    counts[problem.type] = (counts[problem.type] ?? 0) + 1;
    return counts;
  },
  {},
);

export { DEF_POOL };

/**
 * The four options for a question, ready to be shown.
 *
 * Only a definition question needs work here. Its wrong options are a pool of
 * six generated at build time, and three are taken from it and shuffled, so
 * asking the same word twice does not show the same three. The other four
 * types have their options fixed and are returned as they are, already shuffled
 * by the caller.
 *
 * The whole point of the file is that this is the only question-building work
 * left at request time, and it is a shuffle of a six-element array.
 */
export function choicesForProblem(
  problem: Pick<Problem, "choices" | "defPool">,
  random: () => number = Math.random,
): string[] {
  if (problem.choices) return [...problem.choices];
  const pool = problem.defPool ?? [];
  if (pool.length < CHOICES_PER_PROBLEM - 1)
    throw new Error("A definition question was generated with too few options.");
  return shuffle(pool, random).slice(0, CHOICES_PER_PROBLEM - 1);
}
