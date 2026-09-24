import { emptyPeriod, type PeriodStats } from "./rewards.ts";
export type CalendarDay = PeriodStats & { day: string };
export type CalendarData = {
  month: string;
  today: string;
  timezone: string;
  days: CalendarDay[];
  totals: PeriodStats & { studyDays: number };
};
export function validMonth(month: string): boolean {
  return (
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 2000
  );
}
export function shiftMonth(month: string, offset: number): string {
  if (!validMonth(month)) throw new Error("Invalid calendar month.");
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function monthDays(month: string): string[] {
  if (!validMonth(month)) throw new Error("Invalid calendar month.");
  const [year, number] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}
export function calendarCells(month: string): (string | null)[] {
  const days = monthDays(month);
  const offset = (new Date(`${days[0]}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function fillCalendarDays(
  month: string,
  saved: CalendarDay[],
): CalendarDay[] {
  const byDay = new Map(saved.map((day) => [day.day, day]));
  return monthDays(month).map((day) => ({
    ...emptyPeriod(),
    ...byDay.get(day),
    day,
  }));
}
export function calendarTotals(
  days: CalendarDay[],
  uniqueWords: number,
): CalendarData["totals"] {
  const result = { ...emptyPeriod(), studyDays: 0 };
  for (const day of days) {
    for (const key of [
      "questions",
      "correct",
      "reveals",
      "newWords",
      "mastered",
      "seconds",
      "credits",
      "stories",
    ] as const)
      result[key] += day[key];
    if (day.questions > 0 || day.seconds > 0 || day.stories > 0)
      result.studyDays++;
  }
  result.words = uniqueWords;
  return result;
}
export function calendarTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}s`;
  if (value < 3600)
    return `${Math.floor(value / 60)}m${value % 60 ? ` ${value % 60}s` : ""}`;
  return `${Math.floor(value / 3600)}h${Math.floor((value % 3600) / 60) ? ` ${Math.floor((value % 3600) / 60)}m` : ""}`;
}
