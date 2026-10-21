import { words } from "@/lib/challenge/bank";
import { database } from "./db";
import {
  isAlreadyInBank,
  practiceWords,
  type AddedWord,
} from "@/lib/challenge/added-words";
import type { Word } from "@/lib/challenge/words";

export type { AddedWord } from "@/lib/challenge/added-words";

/**
 * A parent's own words, oldest first.
 *
 * The statement is exported rather than only the reader so that a caller
 * batching several reads into one round trip can include it. The SQL and the
 * shaping of the rows stay in one place either way.
 */
export const CUSTOM_WORDS_SQL =
  "SELECT id,word,definition,example,created_at FROM custom_words WHERE user_id=? ORDER BY created_at ASC, word ASC";

export type CustomWordRow = {
  id: string;
  word: string;
  definition: string;
  example: string;
  created_at: number;
};

/** The words a parent has added, from rows already read. */
export function customWordsFromRows(rows: CustomWordRow[]): AddedWord[] {
  return rows
    .filter((row) => row.word.trim() && row.definition.trim())
    .map((row) => ({
      id: row.id,
      word: row.word,
      definition: row.definition,
      example: row.example,
      createdAt: row.created_at,
    }));
}

/** Reads a parent's own words, oldest first, skipping any incomplete row. */
export async function customWordsFor(userId: string): Promise<AddedWord[]> {
  const rows = await database()
    .prepare(CUSTOM_WORDS_SQL)
    .bind(userId)
    .all<CustomWordRow>();
  return customWordsFromRows(rows.results);
}

/** Ids a parent has removed. Applies to the word list and to practice. */
export const EXCLUDED_WORD_IDS_SQL =
  "SELECT word_id FROM word_exclusions WHERE user_id=?";

/** The ids a parent has removed, from rows already read. */
export function excludedIdsFromRows(
  rows: { word_id: string }[],
): Set<string> {
  return new Set(rows.map((row) => row.word_id));
}

export async function excludedWordIds(userId: string): Promise<Set<string>> {
  const rows = await database()
    .prepare(EXCLUDED_WORD_IDS_SQL)
    .bind(userId)
    .all<{ word_id: string }>();
  return excludedIdsFromRows(rows.results);
}

/** The words this account should see and practise. */
export const practiceWordsFor = (
  added: AddedWord[],
  excluded: ReadonlySet<string>,
): Word[] => practiceWords(added, excluded, words);

export const isAlreadyInBankFor = (word: string) =>
  isAlreadyInBank(word, words);
