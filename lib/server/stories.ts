import { words } from "@/lib/challenge/bank";
import { dayStart, localDay } from "@/lib/challenge/rewards";
import {
  STORY_CREDITS,
  storyLength,
  storyMinimumSeconds,
  type Story,
  type ReadingProgress,
} from "@/lib/challenge/stories";
import { database } from "./db";
import { HttpError } from "./http";
import { initializeStoryLibrary } from "./story-library";
import { initializeRewards } from "./rewards";

export async function getStory(id: string): Promise<Story> {
  await initializeStoryLibrary();
  const row = await database()
    .prepare("SELECT content FROM stories WHERE id=?")
    .bind(id)
    .first<{ content: string }>();
  if (!row) throw new HttpError(404, "That adventure could not be found.");
  return JSON.parse(row.content) as Story;
}
export async function readingProgress(
  userId: string,
  storyId: string,
): Promise<ReadingProgress> {
  const row = await database()
    .prepare(
      `SELECT r.seconds,c.created_at AS completedAt FROM story_reads r
    LEFT JOIN story_completions c ON c.user_id=r.user_id AND c.story_id=r.story_id
    WHERE r.user_id=? AND r.story_id=?`,
    )
    .bind(userId, storyId)
    .first<ReadingProgress>();
  return row || { seconds: 0, completedAt: null };
}
export async function storyCatalog(userId?: string) {
  await initializeStoryLibrary();
  const rows = (
    await database()
      .prepare(
        `SELECT s.content,c.created_at AS completedAt FROM stories s
    LEFT JOIN story_completions c ON c.story_id=s.id AND c.user_id=? ORDER BY s.level,s.number`,
      )
      .bind(userId || "")
      .all<{ content: string; completedAt: number | null }>()
  ).results;
  return {
    signedIn: Boolean(userId),
    credits: STORY_CREDITS,
    stories: rows.map((row) => {
      const story = JSON.parse(row.content) as Story;
      return {
        id: story.id,
        level: story.level,
        number: story.number,
        title: story.title,
        summary: story.summary,
        wordCount: story.wordIds.length,
        minutes: Math.ceil(storyLength(story) / 130),
        completed: row.completedAt !== null,
      };
    }),
  };
}
export async function storyDetail(id: string, userId?: string) {
  const story = await getStory(id);
  return {
    ...story,
    question: {
      prompt: story.question.prompt,
      options: story.question.options,
    },
    vocabulary: story.wordIds.map(
      (id) => words.find((word) => word.id === id)!,
    ),
    signedIn: Boolean(userId),
    progress: userId
      ? await readingProgress(userId, id)
      : { seconds: 0, completedAt: null },
    minimumSeconds: storyMinimumSeconds(story),
  };
}
export async function startStory(
  userId: string,
  storyId: string,
  owner: unknown,
) {
  if (typeof owner !== "string" || !/^[a-f0-9-]{36}$/.test(owner))
    throw new HttpError(400, "Invalid reading session.");
  await getStory(storyId);
  await initializeRewards(userId);
  const db = database(),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO story_reads(user_id,story_id,started_at) VALUES(?,?,?)",
      )
      .bind(userId, storyId, now),
    // Opening an adventure deliberately hands the shared clock to this tab.
    // Retrying the same start must not rewind its accepted sequence/time.
    db
      .prepare(
        `INSERT INTO study_clock(user_id,owner,sequence,last_at) VALUES(?,?,0,?)
      ON CONFLICT(user_id) DO UPDATE SET owner=excluded.owner,sequence=0,last_at=excluded.last_at
      WHERE study_clock.owner<>excluded.owner`,
      )
      .bind(userId, owner, now),
  ]);
  return readingProgress(userId, storyId);
}
export async function readingCheckpoint(
  userId: string,
  storyId: string,
  input: Record<string, unknown>,
) {
  if (
    typeof input.owner !== "string" ||
    !/^[a-f0-9-]{36}$/.test(input.owner) ||
    !Number.isSafeInteger(input.sequence) ||
    Number(input.sequence) < 1 ||
    typeof input.seconds !== "number" ||
    !Number.isInteger(input.seconds) ||
    input.seconds < 0 ||
    input.seconds > 30
  )
    throw new HttpError(400, "Invalid reading checkpoint.");
  const db = database();
  const read = await db
    .prepare("SELECT story_id FROM story_reads WHERE user_id=? AND story_id=?")
    .bind(userId, storyId)
    .first();
  if (!read)
    throw new HttpError(409, "Open the story before saving reading time.");
  const now = Date.now(),
    start = dayStart(now),
    id = `${input.owner}:${input.sequence}`;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO study_clock(user_id,owner,sequence,last_at) VALUES(?,?,0,?)",
      )
      .bind(userId, input.owner, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO story_ticks(id,user_id,story_id,seconds,created_at,day,previous_day,since_midnight)
      SELECT ?,user_id,?,CASE WHEN owner=? THEN MIN(?,MAX(0,CAST((?-last_at)/1000 AS INTEGER))) ELSE 0 END,?,?,?,?
      FROM study_clock WHERE user_id=? AND ((owner=? AND sequence<?) OR (owner<>? AND last_at<?))
      AND NOT EXISTS(SELECT 1 FROM study_ticks WHERE id=?)`,
      )
      .bind(
        id,
        storyId,
        input.owner,
        input.seconds,
        now,
        now,
        localDay(now),
        localDay(start - 1),
        Math.floor((now - start) / 1000),
        userId,
        input.owner,
        input.sequence,
        input.owner,
        now - 35000,
        id,
      ),
    db
      .prepare(
        `UPDATE study_clock SET owner=?,sequence=?,last_at=? WHERE user_id=?
      AND EXISTS(SELECT 1 FROM story_ticks WHERE id=? AND user_id=? AND created_at=?) AND last_at<=?`,
      )
      .bind(input.owner, input.sequence, now, userId, id, userId, now, now),
  ]);
  return readingProgress(userId, storyId);
}
export async function completeStory(
  userId: string,
  storyId: string,
  answer: unknown,
) {
  const story = await getStory(storyId);
  if (
    !Number.isInteger(answer) ||
    Number(answer) < 0 ||
    Number(answer) >= story.question.options.length
  )
    throw new HttpError(400, "Choose an answer to the story question.");
  const progress = await readingProgress(userId, storyId);
  if (progress.completedAt)
    return { progress, credits: 0, alreadyCompleted: true };
  if (progress.seconds < storyMinimumSeconds(story))
    throw new HttpError(
      409,
      "Take a little more time with the story before finishing. Your reading time saves while this tab is active.",
    );
  if (answer !== story.question.answer)
    throw new HttpError(
      422,
      "Not quite! Have another look at the story and try again. You won’t lose any credits.",
    );
  const now = Date.now();
  const inserted = await database()
    .prepare(
      `INSERT OR IGNORE INTO story_completions(id,user_id,story_id,created_at,day)
    SELECT ?,user_id,story_id,?,? FROM story_reads WHERE user_id=? AND story_id=? AND seconds>=? RETURNING id`,
    )
    .bind(
      crypto.randomUUID(),
      now,
      localDay(now),
      userId,
      storyId,
      storyMinimumSeconds(story),
    )
    .first();
  return {
    progress: await readingProgress(userId, storyId),
    credits: inserted ? STORY_CREDITS : 0,
    alreadyCompleted: !inserted,
  };
}
