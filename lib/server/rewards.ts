import { database } from "./db";
import { HttpError } from "./http";
import { MISSION_SQL } from "./mission";
import {
  BADGES,
  localDay,
  weekStart,
  dayStart,
  type PeriodStats,
  type Award,
} from "@/lib/challenge/rewards";

/**
 * Replay existing attempts through the same atomic award trigger once per user.
 *
 * The five-correct rule here is frozen history, not the current mastery algorithm in
 * `lib/challenge/mastery.ts`. These attempts predate that algorithm and the credits they
 * earned are already paid and aggregated into daily_stats and the calendar. Do not
 * "fix" this to match the live rules: existing rows are INSERT OR IGNORE, so a change
 * here would not recompute them and could pay a second time.
 */
export async function initializeRewards(userId: string) {
  const db = database();
  const user = await db
    .prepare("SELECT rewards_initialized FROM users WHERE id=?")
    .bind(userId)
    .first<{ rewards_initialized: number }>();
  if (user?.rewards_initialized) return;
  const history = (
    await db
      .prepare(
        `SELECT id,word_id,answered_at,is_correct,selected,elapsed,
    SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) OVER (PARTITION BY word_id ORDER BY answered_at,rowid) AS word_correct
    FROM attempts WHERE user_id=? AND answered_at IS NOT NULL AND selected>=-1 ORDER BY answered_at,rowid`,
      )
      .bind(userId)
      .all<{
        id: string;
        word_id: string;
        answered_at: number;
        is_correct: number;
        selected: number;
        elapsed: number;
        word_correct: number;
      }>()
  ).results;
  await db
    .prepare("INSERT OR IGNORE INTO credit_wallets(user_id) VALUES(?)")
    .bind(userId)
    .run();
  for (let offset = 0; offset < history.length; offset += 40) {
    const statements = history.slice(offset, offset + 40).flatMap((row) => {
      const eligible = row.is_correct && row.word_correct <= 5 ? 1 : 0;
      const mastered = row.is_correct && row.word_correct === 5 ? 1 : 0;
      const day = localDay(row.answered_at);
      return [
        db
          .prepare(
            "INSERT OR IGNORE INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM learning_events WHERE attempt_id=?)",
          )
          .bind(
            `legacy:${row.id}`,
            userId,
            row.answered_at,
            row.elapsed,
            day,
            day,
            86400,
            row.id,
          ),
        db
          .prepare(
            "INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            row.id,
            userId,
            row.word_id,
            row.answered_at,
            day,
            row.is_correct,
            row.selected === -1 ? 1 : 0,
            eligible,
            mastered,
          ),
      ];
    });
    if (statements.length) await db.batch(statements);
  }
  await db
    .prepare("UPDATE users SET rewards_initialized=1 WHERE id=?")
    .bind(userId)
    .run();
}

const DAILY_STATS_SQL = `SELECT day,questions,correct,reveals,new_words AS newWords,mastered,seconds,credits,stories FROM daily_stats WHERE user_id=?`;
const WALLET_SQL =
  "SELECT balance,streak,best_streak AS bestStreak FROM credit_wallets WHERE user_id=?";
const EARNED_SQL =
  "SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE user_id=? AND amount>0";
const PROGRESS_SQL =
  "SELECT word_id,correct,mastered FROM progress WHERE user_id=?";

export type SummaryReads = {
  rows: (PeriodStats & { day: string })[];
  wallet: { balance: number; streak: number; bestStreak: number } | null;
  earned: number;
  mission: { questions: number; stories: number } | null;
  progress: { word_id: string; correct: number; mastered: number }[] | null;
  day: string;
};

/**
 * Every read a stats summary needs, in one round trip.
 *
 * These five statements are mutually independent and depend on nothing but the
 * user id, and they used to be issued one after another: daily_stats, then the
 * wallet, then a SUM over the whole credit ledger, then the mission, then - for
 * a free-tier child - their progress rows. That is five sequential Worker→D1
 * round trips to build one object, and `statsFor` ran it after *both* the answer
 * and the next question, so a child paid ten round trips per question for
 * numbers that, mid-session, were almost always identical to the ones already on
 * screen.
 *
 * A batch is one round trip. The failure domain is unchanged: these were five
 * separate awaited reads, and a failure in any one already failed the request, so
 * nothing is newly all-or-nothing. It is also not a snapshot read - D1 promises
 * sequential, non-concurrent execution and a transactional abort, which is not
 * the same thing, and the local SQLite shim happens to be stricter than that.
 *
 * The optional reads record their position as they are pushed, rather than being
 * counted afterwards or hardcoded. A fixed index here is the quiet kind of bug:
 * reading the progress statement where the mission was expected leaves
 * `questions` and `stories` undefined, `?? 0` turns that into a mission widget
 * reading 0/0 for good, and nothing anywhere reports an error.
 */
export async function summaryReads(
  userId: string,
  options: { mission?: boolean; progress?: boolean } = {},
): Promise<SummaryReads> {
  const db = database();
  const day = localDay(Date.now());
  const statements = [
    db.prepare(DAILY_STATS_SQL).bind(userId),
    db.prepare(WALLET_SQL).bind(userId),
    db.prepare(EARNED_SQL).bind(userId),
  ];
  const missionAt = options.mission
    ? statements.push(db.prepare(MISSION_SQL).bind(userId, day, userId, day)) -
      1
    : -1;
  const progressAt = options.progress
    ? statements.push(db.prepare(PROGRESS_SQL).bind(userId)) - 1
    : -1;
  const out = await db.batch(statements);
  // `db.batch` returns one result per statement, in the order they were given -
  // D1 guarantees that positionally, and the shim preserves it with a map. D1
  // types the rows as unknown, so each is narrowed where it is read rather than
  // by casting the whole result.
  const rowsOf = <T>(index: number): T[] =>
    index < 0
      ? []
      : ((out[index] as { results?: T[] } | undefined)?.results ?? []);
  return {
    rows: rowsOf<PeriodStats & { day: string }>(0),
    wallet:
      rowsOf<{ balance: number; streak: number; bestStreak: number }>(1)[0] ??
      null,
    earned: rowsOf<{ total: number }>(2)[0]?.total ?? 0,
    mission:
      missionAt < 0
        ? null
        : (rowsOf<{ questions: number; stories: number }>(missionAt)[0] ??
          null),
    progress:
      progressAt < 0
        ? null
        : rowsOf<{ word_id: string; correct: number; mastered: number }>(
            progressAt,
          ),
    day,
  };
}

/** The shared shape, so the batched and unbatched paths cannot drift apart. */
export type ProgressSummary = {
  totalEarned: number;
  totals: { mastered: number; newWords: number };
  periods: { today: PeriodStats; week: PeriodStats; all: PeriodStats };
  rewards: { balance: number; streak: number; bestStreak: number };
  dates: { today: string; week: string };
  timezone: string;
};

export function buildSummary(reads: SummaryReads): ProgressSummary {
  const { rows, day } = reads;
  const today = day;
  const monday = weekStart(today);
  const aggregate = (start: string): PeriodStats => {
    const result: PeriodStats = {
      stories: 0,
      questions: 0,
      correct: 0,
      reveals: 0,
      newWords: 0,
      mastered: 0,
      seconds: 0,
      credits: 0,
    };
    for (const row of rows)
      if (row.day >= start && row.day <= today) {
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
          result[key] += row[key];
      }
    return result;
  };
  return {
    totalEarned: reads.earned,
    // Lifetime running totals, straight from the rows already read above. The
    // triggers maintain both counters as words are first met and first mastered,
    // so a full-access child never needs their progress table scanned.
    totals: {
      mastered: rows.reduce((sum, row) => sum + row.mastered, 0),
      newWords: rows.reduce((sum, row) => sum + row.newWords, 0),
    },
    periods: {
      today: aggregate(today),
      week: aggregate(monday),
      all: aggregate(""),
    },
    rewards: reads.wallet || { balance: 0, streak: 0, bestStreak: 0 },
    dates: { today, week: monday },
    timezone: "Europe/London",
  };
}

export async function progressSummary(userId: string) {
  await initializeRewards(userId);
  return buildSummary(await summaryReads(userId));
}

export async function awardFor(
  userId: string,
  attemptId: string,
): Promise<Award> {
  const row = await database()
    .prepare(
      "SELECT base_credits AS base,streak_credits AS streak,mastery_credits AS mastery,streak AS currentStreak FROM learning_events WHERE user_id=? AND attempt_id=?",
    )
    .bind(userId, attemptId)
    .first<Omit<Award, "total">>();
  return row
    ? { ...row, total: row.base + row.streak + row.mastery }
    : { base: 0, streak: 0, mastery: 0, currentStreak: 0, total: 0 };
}

export async function rewardHistory(userId: string, before = 0) {
  const collection = (
    await database()
      .prepare(
        "SELECT badge_id,COUNT(*) AS count FROM badge_redemptions WHERE user_id=? GROUP BY badge_id",
      )
      .bind(userId)
      .all<{ badge_id: string; count: number }>()
  ).results;

  await initializeRewards(userId);
  const db = database();
  // Offset pagination uses the immutable ledger insertion order, not timestamps with ties.
  const offset = Math.max(0, Math.min(100000, before));
  const transactions = (
    await db
      .prepare(
        `SELECT t.id,t.amount,t.reason,t.balance_after,t.created_at,e.base_credits AS base,e.streak_credits AS streak,e.mastery_credits AS mastery
    FROM credit_transactions t LEFT JOIN learning_events e ON e.attempt_id=t.reference AND t.reason='learning'
    WHERE t.user_id=? ORDER BY t.rowid DESC LIMIT 31 OFFSET ?`,
      )
      .bind(userId, offset)
      .all()
  ).results;
  const receipts = (
    await db
      .prepare(
        "SELECT id,badge_id,badge_name,cost,created_at FROM badge_redemptions WHERE user_id=? ORDER BY rowid DESC LIMIT 31 OFFSET ?",
      )
      .bind(userId, offset)
      .all()
  ).results;
  return {
    collection: Object.fromEntries(
      collection.map((item) => [item.badge_id, item.count]),
    ),
    transactions: transactions.slice(0, 30),
    receipts: receipts.slice(0, 30),
    more: transactions.length > 30 || receipts.length > 30,
    nextOffset: offset + 30,
  };
}

export async function redeem(
  userId: string,
  badgeId: string,
  requestKey: string,
) {
  const badge = BADGES.find((item) => item.id === badgeId);
  if (!badge || !/^[a-f0-9-]{36}$/.test(requestKey))
    throw new HttpError(400, "Choose a valid badge.");
  await initializeRewards(userId);
  const db = database();
  const now = Date.now();
  // One id for the whole request, derived from the key the client sent, so a
  // retried request collapses onto the same rows instead of charging twice.
  const receiptId = `r:${requestKey}`;
  // One batch, in an order where each step is only reachable if the previous one
  // actually happened.
  //
  // This used to be a BEFORE INSERT trigger raising INSUFFICIENT_CREDITS and an
  // AFTER INSERT trigger debiting the purse. The guarantee was real - check and
  // debit inside one statement - but the rule lived in SQL where nothing in this
  // repository could read it, and the amount was applied by a trigger nobody
  // called.
  //
  // The subtlety is the debit has to be idempotent, and the first version of
  // this was not: it guarded the balance but not the request key, so a client
  // retry debited a second time while the receipt insert was ignored. Deriving
  // the id from the request key is what fixes it, and it is the same job the
  // trigger's `WHEN NOT EXISTS(request_key)` clause was doing.
  await db.batch([
    // Only reachable if the money is there, and only ever once per request.
    db
      .prepare(
        `INSERT OR IGNORE INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
         SELECT ?,?,?,'badge',?,balance-?,? FROM credit_wallets
         WHERE user_id=? AND balance>=?`,
      )
      .bind(
        receiptId,
        userId,
        -badge.cost,
        receiptId,
        badge.cost,
        now,
        userId,
        badge.cost,
      ),
    // The receipt is written only if the money actually moved, so an
    // unaffordable request leaves nothing behind to look like a success.
    db
      .prepare(
        `INSERT OR IGNORE INTO badge_redemptions(id,user_id,request_key,badge_id,badge_name,cost,created_at)
         SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_transactions WHERE id=?)`,
      )
      .bind(
        receiptId,
        userId,
        requestKey,
        badge.id,
        badge.name,
        badge.cost,
        now,
        receiptId,
      ),
    // The debit, last.
    //
    // The guard is deliberately not `EXISTS(ledger row)`. That is true on every
    // replay as well as on the call that created the row, so a retry debited
    // twice - the same double-spend the trigger's `WHEN NOT EXISTS(request_key)`
    // clause used to prevent, and the reason the first version of this was wrong
    // twice before this one.
    //
    // The ledger row records the balance the purse is expected to hold *after*
    // the debit, so "has this already been applied" becomes a comparison rather
    // than a question about provenance: the debit fires only while the purse
    // still holds the amount the row was written against. Once it has moved, the
    // comparison fails forever, for this request and every replay of it.
    db
      .prepare(
        `UPDATE credit_wallets SET balance=balance-?
         WHERE user_id=? AND EXISTS(
           SELECT 1 FROM credit_transactions
           WHERE id=? AND balance_after=credit_wallets.balance-?
         )`,
      )
      .bind(badge.cost, userId, receiptId, badge.cost),
  ]);
  const receipt = await db
    .prepare(
      "SELECT id,badge_id,badge_name,cost,created_at FROM badge_redemptions WHERE user_id=? AND request_key=?",
    )
    .bind(userId, requestKey)
    .first<{ id: string; badge_id: string }>();
  if (!receipt)
    throw new HttpError(409, "You need more credits for this badge.");
  if (receipt.badge_id !== badge.id)
    throw new HttpError(
      409,
      "This request was already used for another badge.",
    );
  return receipt;
}

/** One active tab per user; cumulative sequence and unique tick IDs make retries safe. */
export async function checkpoint(
  userId: string,
  input: {
    owner: string;
    sequence: number;
    seconds: number;
    attemptId: string;
  },
) {
  if (
    !/^[a-f0-9-]{36}$/.test(input.owner) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    !Number.isFinite(input.seconds) ||
    input.seconds < 0 ||
    input.seconds > 300
  )
    throw new HttpError(400, "Invalid study checkpoint.");
  const db = database(),
    now = Date.now(),
    start = dayStart(now),
    id = `${input.owner}:${input.sequence}`;
  const attempt = await db
    .prepare(
      "SELECT id,created_at AS createdAt FROM attempts WHERE id=? AND user_id=? AND (answered_at IS NULL OR answered_at>=?)",
    )
    .bind(input.attemptId, userId, now - 86400000)
    .first<{ id: string; createdAt: number }>();
  if (!attempt)
    throw new HttpError(
      409,
      "Open a current practice question to record study time.",
    );
  // A brand new clock starts at the moment the question was handed out, not at
  // the moment of this request. The tick below clamps the claim to the wall time
  // that has actually gone by since `last_at`, so starting the clock at "now"
  // meant the very first tick of every session computed MIN(claim, 0) and
  // recorded nothing at all. That was harmless while a claim was capped at 15
  // seconds and cost a whole batch once it was capped at 300: a ten minute
  // session recorded 300 seconds instead of 585. The question's own creation is
  // the earliest a child could have begun reading it, which is exactly the
  // reference the clamp wants. Every later tick advances `last_at` to now, so
  // this only ever affects the first request of a session.
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO study_clock(user_id,owner,sequence,last_at) VALUES(?,?,0,?)",
      )
      .bind(userId, input.owner, attempt.createdAt),
    db
      .prepare(
        `INSERT OR IGNORE INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight)
      SELECT ?,user_id,?,CASE WHEN owner=? THEN MIN(?,MAX(0,CAST((?-last_at)/1000 AS INTEGER))) ELSE 0 END,?,?,?
      FROM study_clock WHERE user_id=? AND ((owner=? AND sequence<?) OR (owner<>? AND last_at<?))`,
      )
      // A tick taken by a *different* owner records nothing, and that is
      // deliberate rather than an oversight. The other tab may still be open and
      // may yet claim the time that has gone by, so crediting its elapsed time
      // here would count the same seconds twice. The cost is that a tab taking
      // over discards up to one batch of the previous tab's time, which was at
      // most 15 seconds while batches were that size and is at most a batch
      // interval now. The alternative - crediting it and hoping the old tab does
      // not come back - inflates the number a parent is shown, which is worse
      // than losing some.
      .bind(
        id,
        now,
        input.owner,
        Math.floor(input.seconds),
        now,
        localDay(now),
        localDay(start - 1),
        Math.floor((now - start) / 1000),
        userId,
        input.owner,
        input.sequence,
        input.owner,
        now - 35000,
      ),
    db
      .prepare(
        `UPDATE study_clock SET owner=?,sequence=?,last_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM study_ticks WHERE id=? AND user_id=? AND created_at=?) AND last_at<=?`,
      )
      .bind(input.owner, input.sequence, now, userId, id, userId, now, now),
  ]);
  return progressSummary(userId);
}
