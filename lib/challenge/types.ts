import type { WordSource } from "./words";
import type { QuestionType } from "./config";
export type Question = {
  id: string;
  word: string;
  wordId: string;
  type: QuestionType;
  prompt: string;
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
  inProgress?: number;
  periods?: {
    today: import("./rewards").PeriodStats;
    week: import("./rewards").PeriodStats;
    all: import("./rewards").PeriodStats;
  };
  rewards?: import("./rewards").RewardSummary;
  dates?: { today: string; week: string };
  timezone?: string;
};
export type Feedback = {
  award?: import("./rewards").Award;
  type: QuestionType;
  answer: string;
  correct: boolean;
  skipped: boolean;
  definition: string;
  example: string;
  syn: string;
  ant: string;
  selected: number;
  word: string;
};
export type ChallengeState = {
  question: Question | null;
  stats: Stats;
  demo: boolean;
  complete?: boolean;
  gated?: boolean;
  freeTier?: boolean;
  freeWordCount?: number;
  trial?: boolean;
  trialExpired?: boolean;
  trialDaysRemaining?: number;
  trialDaysConfigured?: number;
  trialEndsAt?: number | null;
  feedback?: Feedback;
};
