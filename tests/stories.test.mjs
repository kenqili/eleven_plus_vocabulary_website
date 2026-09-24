import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";
import { seedStories } from "../lib/server/story-store.ts";
import {
  parseStories,
  validateStories,
  STORY_CREDITS,
} from "../lib/challenge/stories.ts";
import { words } from "../scripts/load-word-bank.mjs";
const stories = parseStories(
  [1, 2, 3, 4, 5].map((level) =>
    readFileSync(`data/stories/level-${level}.txt`, "utf8"),
  ),
);
const levels = JSON.parse(readFileSync("data/word-levels/levels.json", "utf8"));

test("50 reviewed stories cover every level word with marked vocabulary and valid questions", () => {
  assert.deepEqual(validateStories(stories, words, levels.words), []);
  const broken = structuredClone(stories);
  broken[0].wordIds.pop();
  assert.ok(
    validateStories(broken, words, levels.words).some((error) =>
      error.includes("target words"),
    ),
  );
});

test("startup seeding preserves progress, completion awards once, rereading adds time only", async () => {
  const db = openLocalDatabase(":memory:");
  try {
    await seedStories(db, stories);
    await db
      .prepare(
        "INSERT INTO users(id,email,password,created_at) VALUES('reader','reader@example.test','test-only',0)",
      )
      .run();
    const id = stories[0].id;
    await db
      .prepare(
        "INSERT INTO story_reads(user_id,story_id,started_at) VALUES('reader',?,0)",
      )
      .bind(id)
      .run();
    const tick = (tickId, seconds) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO story_ticks(id,user_id,story_id,seconds,created_at,day,previous_day,since_midnight) VALUES(?,'reader',?,?,1,'2026-09-24','2026-09-23',10)",
        )
        .bind(tickId, id, seconds)
        .run();
    await tick("first", 30);
    await tick("first", 30);
    assert.equal(
      (await db.prepare("SELECT seconds FROM story_reads").first()).seconds,
      30,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT seconds FROM daily_stats WHERE day='2026-09-24'")
          .first()
      ).seconds,
      10,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT seconds FROM daily_stats WHERE day='2026-09-23'")
          .first()
      ).seconds,
      20,
    );
    const complete = (completionId) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO story_completions(id,user_id,story_id,created_at,day) VALUES(?,'reader',?,1,'2026-09-24')",
        )
        .bind(completionId, id)
        .run();
    await Promise.all([complete("finish1"), complete("finish2")]);
    assert.equal(
      (await db.prepare("SELECT balance FROM credit_wallets").first()).balance,
      STORY_CREDITS,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM credit_transactions WHERE reason='story'",
          )
          .first()
      ).n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT stories FROM daily_stats WHERE day='2026-09-24'")
          .first()
      ).stories,
      1,
    );
    await tick("second", 20);
    assert.equal(
      (await db.prepare("SELECT seconds FROM story_reads").first()).seconds,
      50,
    );
    assert.equal(
      (await db.prepare("SELECT balance FROM credit_wallets").first()).balance,
      STORY_CREDITS,
    );
    const revised = structuredClone(stories);
    revised[0].title += "!";
    await seedStories(db, revised);
    await seedStories(db, revised);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM stories").first()).n,
      50,
    );
    assert.equal(
      JSON.parse(
        (
          await db
            .prepare("SELECT content FROM stories WHERE id=?")
            .bind(id)
            .first()
        ).content,
      ).title,
      revised[0].title,
    );
    assert.equal(
      (await db.prepare("SELECT seconds FROM story_reads").first()).seconds,
      50,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM progress").first()).n,
      0,
      "reading must not pretend words are mastered",
    );
  } finally {
    db.close();
  }
});
