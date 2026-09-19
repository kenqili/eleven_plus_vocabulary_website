import type { WordSource } from "./words";
export type Question = {
  id: string;
  word: string;
  wordId: string;
  source: WordSource;
  number: number;
  choices: string[];
  correctCount: number;
  seen: number;
};
export type Stats = {
  total: number;
  mastered: number;
  correct: number;
  todaySeconds: number;
  totalSeconds: number;
};
export type Feedback = {
  correct: boolean;
  skipped: boolean;
  definition: string;
  selected: number;
  word: string;
};
export type ChallengeState = {
  question: Question | null;
  stats: Stats;
  demo: boolean;
  complete?: boolean;
  feedback?: Feedback;
};
