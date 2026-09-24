import { database } from "./db";
import { HttpError } from "./http";
import {
  BADGES,
  localDay,
  weekStart,
  dayStart,
  type PeriodStats,
  type Award,
} from "@/lib/challenge/rewards";

/** Replay existing attempts through the same atomic award trigger once per user. */
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

export async function progressSummary(userId: string) {
  await initializeRewards(userId);
  const db = database(),
    today = localDay(Date.now()),
    monday = weekStart(today);
  const rows = (
    await db
      .prepare(
        `SELECT day,questions,correct,reveals,new_words AS newWords,mastered,seconds,credits,stories FROM daily_stats WHERE user_id=?`,
      )
      .bind(userId)
      .all<PeriodStats & { day: string }>()
  ).results;
  const distinct = (
    await db
      .prepare(
        `SELECT word_id,MIN(day) AS firstDay,MAX(day) AS lastDay FROM learning_events WHERE user_id=? GROUP BY word_id`,
      )
      .bind(userId)
      .all<{ word_id: string; firstDay: string; lastDay: string }>()
  ).results;
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
      words: 0,
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
    result.words = distinct.filter(
      (row) => row.lastDay >= start && row.lastDay <= today,
    ).length;
    return result;
  };
  const wallet = await db
    .prepare(
      "SELECT balance,streak,best_streak AS bestStreak FROM credit_wallets WHERE user_id=?",
    )
    .bind(userId)
    .first<{ balance: number; streak: number; bestStreak: number }>();
  return {
    periods: {
      today: aggregate(today),
      week: aggregate(monday),
      all: aggregate(""),
    },
    rewards: wallet || { balance: 0, streak: 0, bestStreak: 0 },
    dates: { today, week: monday },
    timezone: "Europe/London",
  };
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
  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO badge_redemptions(id,user_id,request_key,badge_id,badge_name,cost,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        userId,
        requestKey,
        badge.id,
        badge.name,
        badge.cost,
        Date.now(),
      )
      .run();
  } catch (error) {
    if (String(error).includes("INSUFFICIENT_CREDITS"))
      throw new HttpError(409, "You need more credits for this badge.");
    throw error;
  }
  const receipt = await db
    .prepare(
      "SELECT id,badge_id,badge_name,cost,created_at FROM badge_redemptions WHERE user_id=? AND request_key=?",
    )
    .bind(userId, requestKey)
    .first<{ badge_id: string }>();
  if (receipt?.badge_id !== badge.id)
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
    input.seconds > 30
  )
    throw new HttpError(400, "Invalid study checkpoint.");
  const db = database(),
    now = Date.now(),
    start = dayStart(now),
    id = `${input.owner}:${input.sequence}`;
  const attempt = await db
    .prepare(
      "SELECT id FROM attempts WHERE id=? AND user_id=? AND (answered_at IS NULL OR answered_at>=?)",
    )
    .bind(input.attemptId, userId, now - 86400000)
    .first();
  if (!attempt)
    throw new HttpError(
      409,
      "Open a current practice question to record study time.",
    );
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO study_clock(user_id,owner,sequence,last_at) VALUES(?,?,0,?)",
      )
      .bind(userId, input.owner, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight)
      SELECT ?,user_id,?,CASE WHEN owner=? THEN MIN(?,MAX(0,CAST((?-last_at)/1000 AS INTEGER))) ELSE 0 END,?,?,?
      FROM study_clock WHERE user_id=? AND ((owner=? AND sequence<?) OR (owner<>? AND last_at<?))`,
      )
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
