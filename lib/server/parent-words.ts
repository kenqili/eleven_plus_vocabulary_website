import { words } from "@/lib/challenge/bank";
import { database } from "./db";
import {
  isAlreadyInBank,
  practiceWords,
  type AddedWord,
} from "@/lib/challenge/added-words";
import type { Word } from "@/lib/challenge/words";

export type { AddedWord } from "@/lib/challenge/added-words";

/** Reads a parent's own words, oldest first, skipping any incomplete row. */
export async function customWordsFor(userId: string): Promise<AddedWord[]> {
  const db = database();
  const rows = await db
    .prepare(
      "SELECT id,word,definition,example,created_at FROM custom_words WHERE user_id=? ORDER BY created_at ASC, word ASC",
    )
    .bind(userId)
    .all<{
      id: string;
      word: string;
      definition: string;
      example: string;
      created_at: number;
    }>();
  return rows.results
    .filter((row) => row.word.trim() && row.definition.trim())
    .map((row) => ({
      id: row.id,
      word: row.word,
      definition: row.definition,
      example: row.example,
      createdAt: row.created_at,
    }));
}

/** Ids a parent has removed. Applies to the word list and to practice. */
export async function excludedWordIds(userId: string): Promise<Set<string>> {
  const db = database();
  const rows = await db
    .prepare("SELECT word_id FROM word_exclusions WHERE user_id=?")
    .bind(userId)
    .all<{ word_id: string }>();
  return new Set(rows.results.map((row) => row.word_id));
}

/** The words this account should see and practise. */
export const practiceWordsFor = (
  added: AddedWord[],
  excluded: ReadonlySet<string>,
): Word[] => practiceWords(added, excluded, words);

export const isAlreadyInBankFor = (word: string) =>
  isAlreadyInBank(word, words);
