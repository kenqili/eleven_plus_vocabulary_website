import type { Story } from "../challenge/stories.ts";

/** Idempotent upserts preserve reading records when a story's wording improves. */
export async function seedStories(db: D1Database, stories: Story[]) {
  for (let offset = 0; offset < stories.length; offset += 20) {
    await db.batch(
      stories.slice(offset, offset + 20).map((story) =>
        db
          .prepare(
            `INSERT INTO stories(id,level,number,content) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET level=excluded.level,number=excluded.number,content=excluded.content
        WHERE content<>excluded.content`,
          )
          .bind(story.id, story.level, story.number, JSON.stringify(story)),
      ),
    );
  }
}
