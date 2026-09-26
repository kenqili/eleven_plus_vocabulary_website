import { localDay } from "@/lib/challenge/rewards";
import { database } from "./db";
import type { Mission } from "@/lib/challenge/mission";
export async function missionFor(userId: string): Promise<Mission> {
  const day = localDay(Date.now());
  const row = await database()
    .prepare(
      `SELECT
    COALESCE((SELECT MAX(0,questions-reveals) FROM daily_stats WHERE user_id=? AND day=?),0) AS questions,
    (SELECT COUNT(*) FROM daily_story_finishes WHERE user_id=? AND day=?) AS stories`,
    )
    .bind(userId, day, userId, day)
    .first<{ questions: number; stories: number }>();
  return { day, questions: row?.questions ?? 0, stories: row?.stories ?? 0 };
}
