export const DIFFICULTY_LEVELS = {
  0: "Level 0 · Start",
  1: "Level 1 · Easy",
  2: "Level 2 · Medium",
  3: "Level 3 · Hard",
  4: "Level 4 · Harder",
  5: "Level 5 · Hardest",
} as const;
export type Difficulty = keyof typeof DIFFICULTY_LEVELS;
export type DifficultyInfo = {
  difficulty: Difficulty;
  letterCount: number;
  frequencyZipf: number;
  frequencyKind: "word" | "phrase-estimate" | "unavailable";
};
export type DifficultyFilter = "all" | Difficulty;
