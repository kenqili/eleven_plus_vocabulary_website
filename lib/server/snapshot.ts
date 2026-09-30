import manifest from "../../data/client-bank.json" with { type: "json" };
import { RECENT_WORD_WINDOW } from "@/lib/challenge/ordering";
import { statsFor } from "./challenge";
import { initializeRewards } from "./rewards";
import { database } from "./db";
import type { Stats } from "@/lib/challenge/types";
import type { AddedWord } from "@/lib/challenge/added-words";

/**
 * Everything the browser needs to build its own questions, in one response.
 *
 * Question generation is moving out of the request path and into the client, so
 * the server's job stops being "hand over the next question" and becomes "hand
 * over the state that decides which question comes next". That state is small
 * and it is read once per session, which is the right shape for it: the thing
 * that was expensive was doing it per question, not doing it at all.
 *
 * The ordering rules are already pure and already client-safe
 * (`lib/challenge/ordering.ts`), so the client needs the same inputs the server
 * would have used rather than a decision. Anything derived stays on the server
 * so there is one answer and not two.
 */

/**
 * A word's progress, as a tuple rather than an object.
 *
 * This is the one part of the payload that scales with the child rather than
 * with the session: a practised child has a row per word they have met, which
 * is up to 2,247. A tuple costs about a third of the same fields as an object,
 * and the column order is fixed by the type below so the client cannot drift
 * from it.
 */
/**
 * A progress row as the driver returns it: one object per row, keyed by column.
 * The tuple below is what goes on the wire.
 */
type ProgressColumns = {
  word_id: string;
  correct: number;
  run: number;
  recalls: number;
  mastered: number;
  seen: number;
  last_seen: string | null;
  retry_at: number | null;
};

export type ProgressRow = [
  wordId: string,
  correct: number,
  run: number,
  recalls: number,
  mastered: number,
  seen: number,
  /** The reporting day this word was last shown, as YYYY-MM-DD, or null. */
  lastSeen: string | null,
  /**
   * The attempt count at which this word becomes due for review, or null.
   *
   * A logical clock, not a timestamp: `reviewDueAt` is an attempt count
   * (`lib/challenge/ordering.ts`), so a client that owned the clock would have to
   * increment it locally. It is returned so the client can compare against a
   * count the server agrees with, and every flush returns the server's number
   * again so the two cannot drift apart unnoticed.
   */
  retryAt: number | null,
];

export type Snapshot = {
  /**
   * Which bank this account may use, and where to fetch it.
   *
   * Named here rather than left to the client, because which words an account
   * may use is a server decision. The free tier is enforced by being sent a
   * smaller file, not by something in the browser declining to use a larger one.
   */
  bank: { tier: "full" | "free"; url: string; words: number; problems: number };
  account: {
    /** IANA zone, for the reporting day boundary. */
    timezone: string;
    /** True when this account may only use the free collection. */
    freeTier: boolean;
    trialDaysRemaining: number;
  };
  /**
   * The logical clock, and the words most recently attempted, newest first.
   *
   * `recent` is bounded rather than complete. The server passes the whole
   * distinct history to `chooseWord`, which filters it to the words it can
   * currently offer and then takes twenty; sending more than the window cannot
   * change the answer, and sending fewer would if enough of the head were
   * excluded words. Forty leaves room for twenty exclusions, which is far more
   * than a parent realistically sets aside.
   */
  clock: { attemptCount: number; recent: string[] };
  progress: ProgressRow[];
  /** A parent's own words, which are not in the bank and cannot be generated. */
  addedWords: AddedWord[];
  /** Words a parent has set aside. The client must never offer these. */
  excluded: string[];
  /** The same summary the practice page and panels already receive. */
  stats: Stats;
};

/** How many recent words to send. See `clock.recent` above. */
const RECENT_SENT = RECENT_WORD_WINDOW * 2;

export async function progressSnapshot(
  userId: string,
  access: { freeTier: boolean; trialDaysRemaining: number },
): Promise<Snapshot> {
  // Ahead of the reads, for the same reason it is ahead of them in statsFor: the
  // backfill writes learning_events, and the triggers on those maintain the very
  // counters being read.
  await initializeRewards(userId);
  const db = database();
  const [progress, count, recent, excluded, added, account] = (await db.batch([
    db
      .prepare(
        "SELECT word_id,correct,run,recalls,mastered,seen,last_seen,retry_at FROM progress WHERE user_id = ?",
      )
      .bind(userId),
    db
      .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ?")
      .bind(userId),
    db
      .prepare(
        "SELECT word_id FROM attempts WHERE user_id = ? GROUP BY word_id ORDER BY MAX(rowid) DESC LIMIT ?",
      )
      .bind(userId, RECENT_SENT),
    db
      .prepare("SELECT word_id FROM word_exclusions WHERE user_id = ?")
      .bind(userId),
    db
      .prepare(
        "SELECT id,word,definition,example,created_at FROM custom_words WHERE user_id=? ORDER BY created_at ASC, word ASC",
      )
      .bind(userId),
    db.prepare("SELECT timezone FROM users WHERE id=?").bind(userId),
    // D1 types a batch result as one wide union, so each element is narrowed
    // where it is read rather than by casting the array.
  ])) as unknown as [
    { results: ProgressColumns[] },
    { results: { count: number }[] },
    { results: { word_id: string }[] },
    { results: { word_id: string }[] },
    { results: (AddedWord & { created_at: number })[] },
    { results: { timezone: string }[] },
  ];

  const tier: Snapshot["bank"]["tier"] = access.freeTier ? "free" : "full";
  const entry = (manifest as Record<string, Omit<Snapshot["bank"], "tier">>)[
    tier
  ];
  return {
    bank: { tier, ...entry },
    account: {
      timezone: account.results[0]?.timezone ?? "Europe/London",
      freeTier: access.freeTier,
      trialDaysRemaining: access.trialDaysRemaining,
    },
    clock: {
      // Not the answered-only count: the review clock is the total number of
      // attempts, and that is the number `retry_at` was written against.
      attemptCount: count.results[0]?.count ?? 0,
      recent: recent.results.map((row) => row.word_id),
    },
    // Mapped to tuples rather than passed through. A driver hands back an object
    // per row keyed by column name, and repeating those names for every word a
    // practised child has met is most of the payload. The order is fixed by
    // `ProgressRow` above, so the client cannot drift from it.
    progress: progress.results.map(
      (row): ProgressRow => [
        row.word_id,
        row.correct,
        row.run,
        row.recalls,
        row.mastered,
        row.seen,
        row.last_seen,
        row.retry_at,
      ],
    ),
    addedWords: added.results
      // The same filter customWordsFor applies: a word with no word or no
      // definition cannot be asked about, and the client must not be handed one
      // it would then try to build a question from.
      .filter((row) => row.word.trim() && row.definition.trim())
      .map((row) => ({
        id: row.id,
        word: row.word,
        definition: row.definition,
        example: row.example,
        createdAt: row.created_at,
      })),
    excluded: excluded.results.map((row) => row.word_id),
    stats: await statsFor(userId),
  };
}
