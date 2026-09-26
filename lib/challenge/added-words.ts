import type { Word } from "./words.ts";
import type { DifficultyInfo } from "./difficulty.ts";

/** A word a parent has added for their own child. */
export type AddedWord = {
  id: string;
  word: string;
  definition: string;
  example: string;
  createdAt: number;
};

/** A parent's own word, in the shape the rest of the app expects. */
export type CustomWord = Word & { custom: true };

export const normaliseWord = (value: string) =>
  value.normalize("NFKC").toLowerCase().trim();

/**
 * A parent's own word is namespaced so it can never collide with a bank word
 * in the progress table or an attempts row.
 */
export function toCustomWord(added: AddedWord): CustomWord {
  return {
    id: `own:${normaliseWord(added.word)}`,
    word: added.word,
    definition: added.definition,
    // No relations are collected for a parent's own words; this is the same
    // "none" marker the shipped bank uses.
    syn: "—",
    ant: "—",
    example: added.example,
    source: "vocabquest",
    custom: true,
  };
}

/**
 * A parent's own word has no corpus frequency, so difficulty is estimated
 * from length alone: longer words sit in a harder band.
 */
export function difficultyForAddedWord(word: string): DifficultyInfo {
  const letterCount = [...word].filter((c) => /\p{L}/u.test(c)).length;
  return {
    letterCount,
    frequencyZipf: 0,
    frequencyKind: "unavailable",
    difficulty:
      letterCount <= 5
        ? 0
        : letterCount <= 7
          ? 1
          : letterCount <= 9
            ? 2
            : letterCount <= 11
              ? 3
              : letterCount <= 13
                ? 4
                : 5,
  };
}

/** True when the shipped bank already teaches this word. */
export const isAlreadyInBank = (word: string, bank: readonly Word[]) =>
  new Set(bank.map((entry) => entry.id)).has(normaliseWord(word));

/** Bank words minus the parent's exclusions, plus their own additions. */
export function practiceWords(
  added: AddedWord[],
  excluded: ReadonlySet<string>,
  bank: readonly Word[],
): Word[] {
  const shipped = new Set(bank.map((word) => word.id));
  const custom = added
    .filter((row) => !shipped.has(normaliseWord(row.word)))
    .map(toCustomWord)
    .filter((word) => !excluded.has(word.id));
  return [...bank.filter((word) => !excluded.has(word.id)), ...custom];
}
