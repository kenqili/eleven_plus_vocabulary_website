export const DIFFICULTY_LEVELS = {
  1: "Level 1 · Foundation",
  2: "Level 2 · Developing",
  3: "Level 3 · Intermediate",
  4: "Level 4 · Advanced",
  5: "Level 5 · Challenge",
} as const;
export type Difficulty = keyof typeof DIFFICULTY_LEVELS;
export type DifficultyInfo = {
  difficulty: Difficulty;
  letterCount: number;
  frequencyZipf: number;
  frequencyKind: "word" | "phrase-estimate" | "unavailable";
};
export type DifficultyFilter = "all" | Difficulty;
