import { database } from "./db";
import { initializeRewards } from "./rewards";
import {
  localDay,
  REPORTING_ZONE,
  type PeriodStats,
} from "@/lib/challenge/rewards";
import {
  calendarTotals,
  fillCalendarDays,
  monthDays,
  type CalendarData,
} from "@/lib/challenge/calendar";
export async function learningCalendar(
  userId: string,
  month: string,
): Promise<CalendarData> {
  await initializeRewards(userId);
  const db = database(),
    dates = monthDays(month),
    start = dates[0],
    end = dates[dates.length - 1];
  const [daily, distinct, total] = await Promise.all([
    db
      .prepare(
        `SELECT day,questions,correct,reveals,new_words AS newWords,mastered,seconds,credits,stories
      FROM daily_stats WHERE user_id=? AND day>=? AND day<=? ORDER BY day`,
      )
      .bind(userId, start, end)
      .all<Omit<PeriodStats, "words"> & { day: string }>(),
    db
      .prepare(
        `SELECT day,COUNT(DISTINCT word_id) AS words FROM learning_events
      WHERE user_id=? AND day>=? AND day<=? GROUP BY day`,
      )
      .bind(userId, start, end)
      .all<{ day: string; words: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT word_id) AS words FROM learning_events
      WHERE user_id=? AND day>=? AND day<=?`,
      )
      .bind(userId, start, end)
      .first<{ words: number }>(),
  ]);
  const counts = new Map(distinct.results.map((row) => [row.day, row.words]));
  const days = fillCalendarDays(
    month,
    daily.results.map((row) => ({ ...row, words: counts.get(row.day) || 0 })),
  );
  return {
    month,
    today: localDay(Date.now()),
    timezone: REPORTING_ZONE,
    days,
    totals: calendarTotals(days, total?.words || 0),
  };
}
