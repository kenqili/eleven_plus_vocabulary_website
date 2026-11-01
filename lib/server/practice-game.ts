import { levelOf, problemById, problems, words } from "@/lib/challenge/bank";
import { QUESTION_TYPES, type QuestionType } from "@/lib/challenge/config";
import { hasMastered } from "@/lib/challenge/mastery";
import {
  buildPracticeQuestions,
  gradePracticeAnswer,
  PRACTICE_QUESTIONS_PER_MATCH,
  type PracticeGameQuestion,
} from "@/lib/challenge/practice-game";
import { problemsForAddedWords } from "@/lib/challenge/problems";
import type {
  RelationFinish,
  RelationMatch,
  RelationResult,
} from "@/lib/challenge/relations";
import { database } from "./db";
import { freeWordIds, isAllowedWord } from "./free-words";
import { historyFor, recordGameMatch } from "./game-match";
import { HttpError } from "./http";
import {
  customWordsFor,
  excludedWordIds,
  practiceWordsFor,
} from "./parent-words";
import { placementLevelFor } from "./placement";

/**
 * The mixed-practice game: ten of the practice questions, then a score.
 *
 * The pool is the practice collection - the bank plus a parent's own words,
 * minus the words they set aside and the words already mastered - so the game
 * revises what the child is actually working on. The questions are the bank's
 * own, not a second set written for the game.
 *
 * Like the relation games, the browser marks the answers and the endpoint
 * grades them again from the bank, so a tampered client can claim a score but
 * cannot award itself a correctness.
 */

export type PracticeGameState = {
  kind: "mix";
  questions: PracticeGameQuestion[];
  history: RelationMatch[];
  /**
   * The band the questions were drawn from, when the practice pool had enough
   * words in it to fill a match. Null when the pool was widened, so the page
   * never claims an alignment it did not make.
   */
  level: number | null;
};

/** The ten questions a signed-out visitor plays. The free collection, no history. */
export function guestPracticeQuestions(): PracticeGameQuestion[] {
  const allowed = freeWordIds();
  return buildPracticeQuestions({
    targets: words.filter((word) => allowed.has(word.id)),
    problems,
  });
}

export async function startPracticeGame(
  userId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<PracticeGameState> {
  const db = database();
  const [excluded, added, rows] = await Promise.all([
    excludedWordIds(userId),
    customWordsFor(userId),
    db
      .prepare("SELECT word_id,correct,mastered FROM progress WHERE user_id=?")
      .bind(userId)
      .all<{ word_id: string; correct: number; mastered: number }>(),
  ]);
  const pool = practiceWordsFor(added, excluded);
  const bankIds = new Set(words.map((word) => word.id));
  const customProblems = problemsForAddedWords(
    pool.filter((word) => !bankIds.has(word.id)),
    words,
  );
  const allProblems = [
    ...problems.filter((problem) => !excluded.has(problem.wordId)),
    ...customProblems,
  ];
  // Practice retires a word once it is mastered; the game does the same, or it
  // would spend a tenth of the match on a word that can earn nothing.
  const mastered = new Set(
    (rows.results ?? [])
      .filter((row) =>
        hasMastered({ mastered: row.mastered, correct: row.correct }),
      )
      .map((row) => row.word_id),
  );
  const targets = pool.filter((word) =>
    isAllowedWord(word.id, allowedWordIds),
  );
  if (!targets.length)
    throw new HttpError(
      402,
      "There are no words to play with yet. Practise a few words first.",
    );

  // The same band the practice screen would be working in, counted over the
  // game's own pool. Counted before mastered words are dropped, because the
  // placement reads mastery: counting only the unmastered words would report
  // band 1 for every account, which is the one band the alignment must not
  // collapse to. A band that cannot fill ten questions widens to the whole
  // pool rather than returning a two-question match.
  const level = await placementLevelFor(userId, targets);
  const playable = targets.filter((word) => !mastered.has(word.id));
  const inBand = playable.filter((word) => levelOf.get(word.id) === level);
  const aligned = inBand.length >= PRACTICE_QUESTIONS_PER_MATCH;
  const questions = buildPracticeQuestions({
    targets: aligned ? inBand : playable,
    problems: allProblems,
  });
  if (!questions.length)
    throw new HttpError(402, "There are no words to play with yet.");
  return {
    kind: "mix",
    questions,
    history: await historyFor(userId, "mix"),
    level: aligned ? level : null,
  };
}

export async function finishPracticeMatch(
  userId: string,
  matchId: string,
  submitted: readonly unknown[],
  seconds: unknown,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<RelationFinish> {
  const [excluded, added] = await Promise.all([
    excludedWordIds(userId),
    customWordsFor(userId),
  ]);
  const pool = practiceWordsFor(added, excluded);
  const byId = new Map(pool.map((word) => [word.id, word]));
  const bankIds = new Set(words.map((word) => word.id));
  const customProblems = problemsForAddedWords(
    pool.filter((word) => !bankIds.has(word.id)),
    words,
  );
  const customById = new Map(
    customProblems.map((problem) => [problem.id, problem]),
  );

  const graded: RelationResult[] = [];
  const seen = new Set<string>();
  for (const entry of submitted.slice(0, PRACTICE_QUESTIONS_PER_MATCH)) {
    if (!entry || typeof entry !== "object") continue;
    const wordId = (entry as { wordId?: unknown }).wordId;
    const type = (entry as { type?: unknown }).type;
    const selected = (entry as { selected?: unknown }).selected;
    if (
      typeof wordId !== "string" ||
      typeof type !== "string" ||
      !(QUESTION_TYPES as readonly string[]).includes(type) ||
      seen.has(wordId)
    )
      continue;
    seen.add(wordId);
    const word = byId.get(wordId);
    if (!word) continue;
    if (!isAllowedWord(word.id, allowedWordIds)) continue;
    const problem =
      problemById.get(`${type as QuestionType}:${wordId}`) ??
      customById.get(`${type}:${wordId}`);
    if (!problem) continue;
    graded.push({
      wordId: word.id,
      word: word.word,
      correct: gradePracticeAnswer(selected, problem.answer),
    });
  }

  return recordGameMatch({ userId, kind: "mix", matchId, graded, seconds });
}
