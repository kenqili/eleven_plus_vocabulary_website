/**
 * The band a word sits in, ordered by how common it is in written English.
 *
 * The bands are a property of the collection, not of the reader and not of the
 * exam, so nothing here calls one band "hardest" - that reads as a verdict on
 * the child. A level means "rarer than the ones before it in this list".
 */
export const DIFFICULTY_LEVELS = {
  0: "Level 0 · everyday words",
  1: "Level 1 · common words",
  2: "Level 2 · less common",
  3: "Level 3 · uncommon",
  4: "Level 4 · literary",
  5: "Level 5 · rare",
} as const;

/** The short form, for a shelf of cards where the full one will not fit. */
export const DIFFICULTY_SHORT = {
  0: "Everyday",
  1: "Common",
  2: "Less common",
  3: "Uncommon",
  4: "Literary",
  5: "Rare",
} as const;
export type Difficulty = keyof typeof DIFFICULTY_LEVELS;
export type DifficultyInfo = {
  difficulty: Difficulty;
  letterCount: number;
  frequencyZipf: number;
  frequencyKind: "word" | "phrase-estimate" | "unavailable";
};
export type DifficultyFilter = "all" | Difficulty;
