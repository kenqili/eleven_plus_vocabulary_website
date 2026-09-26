import levels from "@/data/word-levels/levels.json";
import type { DifficultyInfo } from "@/lib/challenge/difficulty";
import { words } from "@/lib/challenge/bank";
import type { Word } from "@/lib/challenge/words";
import { CUMULATIVE_FLOOR, hasMastered } from "@/lib/challenge/mastery";
import { learningStatus, type WordSummary } from "@/lib/challenge/word-summary";
import {
  customWordsFor,
  excludedWordIds,
} from "./parent-words";
import {
  difficultyForAddedWord,
  isAlreadyInBank,
  toCustomWord,
} from "@/lib/challenge/added-words";
import { database } from "./db";
export async function wordSummary(
  userId: string,
  wordIds?: ReadonlySet<string>,
): Promise<WordSummary[]> {
  const db = database();
  const [progress, history] = await Promise.all([
    db
      .prepare("SELECT word_id,correct,seen,mastered FROM progress WHERE user_id=?")
      .bind(userId)
      .all<{ word_id: string; correct: number; mastered: number; seen: number }>(),
    db
      .prepare(
        `SELECT word_id,
      SUM(CASE WHEN selected>=0 AND is_correct=0 THEN 1 ELSE 0 END) AS mistakes,
      SUM(CASE WHEN selected=-1 THEN 1 ELSE 0 END) AS reveals,
      MAX(answered_at) AS last_practised
      FROM attempts WHERE user_id=? AND answered_at IS NOT NULL AND selected>=-1 GROUP BY word_id`,
      )
      .bind(userId)
      .all<{
        word_id: string;
        mistakes: number;
        reveals: number;
        last_practised: number;
      }>(),
  ]);
  const byWord = new Map(progress.results.map((row) => [row.word_id, row]));
  const byHistory = new Map(history.results.map((row) => [row.word_id, row]));
  // A parent's own settings: words they set aside, and words they added.
  const [excluded, added] = await Promise.all([
    excludedWordIds(userId),
    customWordsFor(userId),
  ]);
  const summarise = (word: Word, difficulty: DifficultyInfo) => {
    const saved = byWord.get(word.id),
      attempts = byHistory.get(word.id);
    const correct = Math.min(CUMULATIVE_FLOOR, saved?.correct || 0),
      seen = saved?.seen || 0;
    const mistakes = attempts?.mistakes || 0,
      reveals = attempts?.reveals || 0;
    return {
      ...difficulty,
      id: word.id,
      word: word.word,
      definition: word.definition,
      example: word.example,
      syn: word.syn,
      ant: word.ant,
      correct,
      seen,
      mistakes,
      reveals,
      lastPractised: attempts?.last_practised || null,
      ...("custom" in word ? { custom: true } : {}),
      status: hasMastered(saved ?? {})
        ? ("mastered" as const)
        : learningStatus({
            mastered: false,
            correct,
            seen,
            mistakes,
            reveals,
          }),
    };
  };
  const levelsById = levels.words as Record<string, DifficultyInfo>;
  return [
    ...words
      .filter((word) => !wordIds || wordIds.has(word.id))
      .filter((word) => !excluded.has(word.id))
      .map((word) => {
        const difficulty = levelsById[word.id];
        if (!difficulty)
          throw new Error(
            `Missing difficulty for ${word.id}; regenerate word levels.`,
          );
        return summarise(word, difficulty);
      }),
    // A parent's own words have no level snapshot, so difficulty is estimated
    // from length. They are not part of the free-tier selection.
    ...(!wordIds
      ? added
          .filter((row) => !isAlreadyInBank(row.word, words))
          .map(toCustomWord)
          .filter((word) => !excluded.has(word.id))
          .map((word) => summarise(word, difficultyForAddedWord(word.word)))
      : []),
  ];
}
