export const BADGES = [
  { id: "spark", name: "Vocabulary Spark", cost: 20, symbol: "✦" },
  { id: "explorer", name: "Word Explorer", cost: 50, symbol: "🧭" },
  { id: "champion", name: "Vocabulary Champion", cost: 100, symbol: "🏆" },
] as const;
export const REPORTING_ZONE = "Europe/London";
export type PeriodStats = {
  stories: number;
  questions: number;
  correct: number;
  reveals: number;
  newWords: number;
  mastered: number;
  seconds: number;
  credits: number;
  words: number;
};
export type RewardSummary = {
  balance: number;
  streak: number;
  bestStreak: number;
};
export type Award = {
  base: number;
  streak: number;
  mastery: number;
  total: number;
  currentStreak: number;
};
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
  words: 0,
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
  return value < 60
    ? `${value} sec`
    : `${Math.floor(value / 60)} min ${value % 60} sec`;
}
