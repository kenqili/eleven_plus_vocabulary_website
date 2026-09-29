import { localDay } from "@/lib/challenge/rewards";
import { database } from "./db";
import type { Mission } from "@/lib/challenge/mission";
/**
 * Shared so a stats summary can fold the mission into its own batch rather than
 * spending a second round trip on it. The mission widget polls this on its own
 * clock, and `statsFor` used to re-read it after every single answer.
 */
export const MISSION_SQL = `SELECT
    COALESCE((SELECT MAX(0,questions-reveals) FROM daily_stats WHERE user_id=? AND day=?),0) AS questions,
    (SELECT COUNT(*) FROM daily_story_finishes WHERE user_id=? AND day=?) AS stories`;
export async function missionFor(userId: string): Promise<Mission> {
  const day = localDay(Date.now());
  const row = await database()
    .prepare(MISSION_SQL)
    .bind(userId, day, userId, day)
    .first<{ questions: number; stories: number }>();
  return { day, questions: row?.questions ?? 0, stories: row?.stories ?? 0 };
}
