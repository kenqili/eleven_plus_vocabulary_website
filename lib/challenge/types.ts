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
  /** Words this account has been shown at least once, which is a denominator
   *  a child can do something about, unlike the size of the whole collection. */
  meetCount?: number;
  periods?: {
    today: import("./rewards").PeriodStats;
    week: import("./rewards").PeriodStats;
    all: import("./rewards").PeriodStats;
  };
  /** Lifetime running totals the server maintains on write. */
  totals?: { mastered: number; newWords: number };
  rewards?: import("./rewards").RewardSummary;
  dates?: { today: string; week: string };
  timezone?: string;
};
export type Feedback = {
  mastery?: import("./mastery").MasteryProgress;
  /** True only on the answer that finished a word, so the moment is distinguishable. */
  newlyMastered?: boolean;
  /**
   * How well the child actually did, which is not the same as being right. A
   * right answer inside the reading window reads as a reflex rather than
   * recall, and the wording after it should not claim otherwise.
   */
  evidence?: import("./mastery").Evidence;
  /**
   * Whole days since this word was last shown, or absent if it is new. The
   * spaced-retrieval fact is the one a child can feel working, so the app says
   * it out loud when there is one.
   */
  daysSince?: number;
  /** The plain-language help for this word, worked out on the server. */
  help?: string;
  /**
   * What the option the child actually chose means, when it was a word rather
   * than a sentence. Choosing "debris" instead of "timid" teaches nothing
   * unless the app says what debris is, and a wrong answer is exactly when a
   * child most needs to know the word they did not pick.
   *
   * Absent for a definition question, where the options are meanings and so
   * there is nothing left to explain.
   */
  chosen?: {
    word: string;
    meaning: string;
    example?: string;
  };
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
  /**
   * A paid term, as opposed to a trial.
   *
   * Present because a banner that cannot tell the two apart tells a parent who
   * has just paid a year how many days of trial they have left. `active` is
   * whether a term is running; `daysRemaining` is how much of it is left, so
   * the practice page can warn before it runs out rather than after.
   */
  active?: boolean;
  daysRemaining?: number;
  /** When the paid term ends, epoch ms. */
  periodEnd?: number | null;
  feedback?: Feedback;
};
