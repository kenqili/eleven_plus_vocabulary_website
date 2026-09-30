export const BADGES = [
  { id: "spark", name: "Vocabulary Spark", cost: 20, symbol: "✦" },
  { id: "explorer", name: "Word Explorer", cost: 50, symbol: "🧭" },
  { id: "champion", name: "Vocabulary Champion", cost: 100, symbol: "🏆" },
] as const;
export const REPORTING_ZONE = "Europe/London";
/** Words in the whole collection, which the calendar counts distinctly itself. */
export type PeriodStats = {
  stories: number;
  questions: number;
  correct: number;
  reveals: number;
  newWords: number;
  mastered: number;
  seconds: number;
  credits: number;
};
export type RewardSummary = {
  balance: number;
  streak: number;
  bestStreak: number;
};
/**
 * What an answer paid.
 *
 * Re-exported from `credits.ts` rather than declared again. There were two of
 * these with the same five numbers and one field called `streakAfter` in the
 * other, which is the kind of difference that survives until a feedback object
 * reaches a component and a number is `undefined`.
 */
export type { Award } from "./credits";
export type Receipt = {
  id: string;
  badge_id: string;
  badge_name: string;
  cost: number;
  created_at: number;
};
export type Transaction = {
  id: string;
  amount: number;
  reason: string;
  balance_after: number;
  created_at: number;
  base: number | null;
  streak: number | null;
  mastery: number | null;
};
export const emptyPeriod = (): PeriodStats => ({
  stories: 0,
  questions: 0,
  correct: 0,
  reveals: 0,
  newWords: 0,
  mastered: 0,
  seconds: 0,
  credits: 0,
});
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORTING_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function localDay(time: number): string {
  return dayFormatter.format(time);
}
export function weekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function dayStart(time: number): number {
  const day = localDay(time);
  // Find the first millisecond of the reporting day, including DST changes.
  let low = time - 27 * 3600000,
    high = time;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDay(mid) < day) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function studyDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  // "0 sec" under a heading called learning time reads as a score of zero, and
  // seconds are not a unit a child thinks in.
  if (value < 60) return "under a minute";
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}
