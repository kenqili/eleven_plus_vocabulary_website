import type { WordSource } from "./words";
import type { QuestionType } from "./config";
export type Question = {
  mastery?: import("./mastery").MasteryProgress;
  difficulty?: number;
  clue: string;
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
  mission?: import("./mission").Mission;
  /** Words this account may practise, which is the free set on a free tier. */
  total: number;
  /**
   * Words in the whole collection. Needed because "subscribe to unlock all
   * twenty words" is otherwise what a parent reads at the moment we ask them
   * to pay.
   */
  collection: number;
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
  mastery?: import("./mastery").MasteryProgress;
  /** True only on the answer that finished a word, so the moment is distinguishable. */
  newlyMastered?: boolean;
  /** The plain-language help for this word, worked out on the server. */
  help?: string;
  /**
   * Identifies this one answer. It is what the sound layer uses to tell one
   * answer from the next, so two right answers in a row are two sounds rather
   * than one sound and silence.
   */
  attemptId?: string;
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
