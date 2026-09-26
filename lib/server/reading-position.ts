import { database } from "./db";
import { HttpError } from "./http";
import type { Story } from "@/lib/challenge/stories";

export type ReadingBookmark = {
  paragraph: number;
  fraction: number;
  revision: number;
  updatedAt: number;
};
export async function readingPreference(userId?: string) {
  if (!userId) return { level: 0, revision: 0 };
  return (
    (await database()
      .prepare("SELECT level,revision FROM reading_preferences WHERE user_id=?")
      .bind(userId)
      .first<{ level: number; revision: number }>()) ?? {
      level: 0,
      revision: 0,
    }
  );
}
export async function saveReadingPreference(
  userId: string,
  input: Record<string, unknown>,
) {
  if (
    !Number.isInteger(input.level) ||
    Number(input.level) < 0 ||
    Number(input.level) > 5 ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0
  )
    throw new HttpError(400, "Choose a valid reading level.");
  await database()
    .prepare("INSERT OR IGNORE INTO reading_preferences(user_id) VALUES(?)")
    .bind(userId)
    .run();
  const result = await database()
    .prepare(
      `UPDATE reading_preferences SET level=?,revision=revision+1 WHERE user_id=? AND revision=? RETURNING level,revision`,
    )
    .bind(input.level, userId, input.revision)
    .first();
  if (!result) {
    const current = await readingPreference(userId);
    if (
      current.revision === Number(input.revision) + 1 &&
      current.level === input.level
    )
      return current;
    throw new HttpError(
      409,
      "Your level changed on another device. Reload to see it.",
    );
  }
  return result;
}
export async function bookmarkFor(
  userId: string | undefined,
  storyId: string,
): Promise<ReadingBookmark | null> {
  if (!userId) return null;
  return database()
    .prepare(
      `SELECT paragraph,fraction/10000.0 AS fraction,bookmark_revision AS revision,bookmarked_at AS updatedAt FROM story_reads WHERE user_id=? AND story_id=? AND bookmarked_at>0`,
    )
    .bind(userId, storyId)
    .first<ReadingBookmark>();
}
export async function saveReadingBookmark(
  userId: string,
  story: Story,
  input: Record<string, unknown>,
) {
  if (
    !Number.isInteger(input.paragraph) ||
    Number(input.paragraph) < 0 ||
    Number(input.paragraph) >= story.paragraphs.length ||
    typeof input.fraction !== "number" ||
    !Number.isFinite(input.fraction) ||
    input.fraction < 0 ||
    input.fraction > 1 ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0
  )
    throw new HttpError(400, "Invalid reading position.");
  const now = Date.now(),
    db = database();
  await db
    .prepare(
      "INSERT OR IGNORE INTO story_reads(user_id,story_id,started_at) VALUES(?,?,?)",
    )
    .bind(userId, story.id, now)
    .run();
  const saved = await db
    .prepare(
      `UPDATE story_reads SET paragraph=?,fraction=?,bookmark_revision=bookmark_revision+1,bookmarked_at=? WHERE user_id=? AND story_id=? AND bookmark_revision=? RETURNING paragraph,fraction/10000.0 AS fraction,bookmark_revision AS revision,bookmarked_at AS updatedAt`,
    )
    .bind(
      input.paragraph,
      Math.round(input.fraction * 10000),
      now,
      userId,
      story.id,
      input.revision,
    )
    .first<ReadingBookmark>();
  if (!saved) {
    // A lost response can safely retry the exact same write, but never overwrite a newer place.
    const current = await bookmarkFor(userId, story.id);
    if (
      current &&
      current.revision === Number(input.revision) + 1 &&
      current.paragraph === input.paragraph &&
      Math.round(current.fraction * 10000) ===
        Math.round(input.fraction * 10000)
    )
      return current;
    throw new HttpError(
      409,
      "Your reading place changed in another tab or device. Reload to sync it.",
    );
  }
  return saved;
}
