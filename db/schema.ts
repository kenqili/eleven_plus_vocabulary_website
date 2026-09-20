import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: integer("created_at").notNull(),
  customerId: text("customer_id").unique(),
  rewardsInitialized: integer("rewards_initialized").notNull().default(0),
});

export const wallets = sqliteTable(
  "credit_wallets",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    streak: integer("streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
  },
  (t) => [check("wallet_nonnegative", sql`${t.balance} >= 0`)],
);

export const learningEvents = sqliteTable(
  "learning_events",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => attempts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: text("word_id").notNull(),
    createdAt: integer("created_at").notNull(),
    day: text("day").notNull(),
    correct: integer("correct").notNull(),
    revealed: integer("revealed").notNull(),
    eligible: integer("eligible").notNull(),
    mastered: integer("mastered").notNull(),
    baseCredits: integer("base_credits").notNull().default(0),
    streakCredits: integer("streak_credits").notNull().default(0),
    masteryCredits: integer("mastery_credits").notNull().default(0),
    streak: integer("streak").notNull().default(0),
  },
  (t) => [
    index("learning_user_date").on(t.userId, t.createdAt),
    index("learning_user_word").on(t.userId, t.wordId),
  ],
);

export const dailyStats = sqliteTable(
  "daily_stats",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    questions: integer("questions").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    reveals: integer("reveals").notNull().default(0),
    newWords: integer("new_words").notNull().default(0),
    mastered: integer("mastered").notNull().default(0),
    seconds: integer("seconds").notNull().default(0),
    credits: integer("credits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const redemptions = sqliteTable(
  "badge_redemptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    badgeId: text("badge_id").notNull(),
    badgeName: text("badge_name").notNull(),
    cost: integer("cost").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("redemption_request").on(t.userId, t.requestKey),
    index("redemption_history").on(t.userId, t.createdAt),
  ],
);

export const creditTransactions = sqliteTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    reference: text("reference").notNull(),
    ruleVersion: integer("rule_version").notNull().default(1),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("credit_history").on(t.userId, t.createdAt)],
);

export const studyClock = sqliteTable("study_clock", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  sequence: integer("sequence").notNull().default(0),
  lastAt: integer("last_at").notNull(),
});

export const studyTicks = sqliteTable(
  "study_ticks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    seconds: integer("seconds").notNull(),
    day: text("day").notNull(),
    previousDay: text("previous_day").notNull(),
    sinceMidnight: integer("since_midnight").notNull(),
  },
  (t) => [index("study_tick_history").on(t.userId, t.createdAt)],
);
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("sessions_user").on(t.userId),
    index("sessions_expiry").on(t.expiresAt),
  ],
);
export const progress = sqliteTable(
  "progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: text("word_id").notNull(),
    correct: integer("correct").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    retryAt: integer("retry_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wordId] })],
);
export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: text("word_id").notNull(),
    choices: text("choices").notNull(),
    questionType: text("question_type").notNull().default("def"),
    answer: text("answer"),
    prompt: text("prompt"),
    createdAt: integer("created_at").notNull(),
    answeredAt: integer("answered_at"),
    selected: integer("selected"),
    isCorrect: integer("is_correct"),
    elapsed: integer("elapsed").notNull().default(0),
  },
  (t) => [
    index("attempts_user_created").on(t.userId, t.createdAt),
    uniqueIndex("attempts_one_pending_per_user")
      .on(t.userId)
      .where(sql`${t.answeredAt} IS NULL`),
  ],
);
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull(),
    periodEnd: integer("period_end").notNull(),
    priceId: text("price_id").notNull(),
    checkedAt: integer("checked_at").notNull(),
  },
  (t) => [index("subscriptions_user").on(t.userId)],
);
export const checkoutRequests = sqliteTable("checkout_requests", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  createdAt: integer("created_at").notNull(),
  sessionId: text("session_id"),
});
