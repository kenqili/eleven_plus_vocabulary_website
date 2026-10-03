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
  /** scrypt, never a plaintext password. See lib/server/password.ts. */
  password: text("password").notNull(),
  createdAt: integer("created_at").notNull(),
  customerId: text("customer_id").unique(),
  rewardsInitialized: integer("rewards_initialized").notNull().default(0),
  /**
   * When access ends, as epoch milliseconds. Null means nothing has been
   * purchased; a trial is then derived from `createdAt` rather than stored, so
   * changing the trial length does not need a migration.
   *
   * This replaced a query against `subscriptions` on every authenticated
   * request. The Stripe webhook is the only writer, which is what makes a single
   * column safe: nothing else may change an entitlement.
   */
  expiryDate: integer("expiry_date"),
  /**
   * Whether this account may issue coupons and see the admin page.
   *
   * Set once by hand, after the account exists:
   *
   *   UPDATE users SET is_admin=1 WHERE email='you@example.com';
   *
   * A column rather than an address compared in code, because a credential in
   * the source is published, cannot be rotated without a deploy, and ties
   * authority to an address a parent can change. `requireAdmin` in
   * lib/server/admin.ts is the only thing that reads this.
   */
  isAdmin: integer("is_admin").notNull().default(0),
  /**
   * The reporting day boundary, IANA. The app used to hardcode Europe/London
   * and compute a child's "today" from it, which put the mission and calendar
   * day boundary in the wrong place for anyone outside the UK.
   */
  timezone: text("timezone").notNull().default("Europe/London"),
  /** Consecutive eligible correct answers, and the best run ever. */
  streak: integer("streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  /**
   * When the address was confirmed, as epoch milliseconds. Null means nobody has
   * proved they can read mail there, and sign-in is refused until someone has.
   *
   * The reason is not politeness. A parent who mistypes their address cannot be
   * told, because the only proof is a message arriving; they practise for the
   * trial and discover at the worst moment that the account can never be
   * recovered, since the password reset would have gone to the same place.
   *
   * Accounts that predate the column were stamped with their own `createdAt` by
   * migration 0014, which records the weaker truth honestly rather than locking
   * out every existing customer on the deploy.
   */
  emailVerifiedAt: integer("email_verified_at"),
});

/**
 * Entitlement history, one row per change, written by the Stripe webhook.
 *
 * `confirmation` is unique because it is the idempotency key for a replayed
 * webhook: Stripe retries deliveries, and without it a retry grants the same
 * purchase twice. `status` is what a refund needs, since an expiry date alone
 * cannot say "refunded" or "cancelled but paid until Friday".
 */
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The Stripe price id this purchase was for. */
    productId: text("product_id").notNull(),
    confirmation: text("confirmation").notNull(),
    originalExpiry: integer("original_expiry"),
    newExpiry: integer("new_expiry").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("purchase_confirmation").on(t.confirmation),
    index("purchases_user").on(t.userId, t.createdAt),
  ],
);

/**
 * A code that buys a parent access without a card.
 *
 * The second way `expiry_date` can be written, and the reason it is safe where a
 * second Stripe price would not be: a coupon is claimed by a single conditional
 * UPDATE, so it cannot be spent twice even if two parents submit it in the same
 * second. See lib/server/coupon.ts.
 */
export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    /** Upper case, unpunctuated, as the parent types it. */
    code: text("code").notNull(),
    /** How much access this buys, in days. Not months: see the migration. */
    days: integer("days").notNull(),
    /** 'unused' or 'redeemed'. Not a boolean - an unknown value must be visible. */
    status: text("status").notNull().default("unused"),
    /** Who spent it. Null until spent. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Which generation produced it, so a batch can be listed or revoked. */
    batch: text("batch").notNull(),
    createdAt: integer("created_at").notNull(),
    redeemedAt: integer("redeemed_at"),
  },
  (t) => [
    uniqueIndex("coupon_code").on(t.code),
    index("coupons_batch").on(t.batch),
    index("coupons_unspent").on(t.status, t.code),
  ],
);

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
    /** How this answer read: recalled, uncertain, assisted or missed. */
    evidence: text("evidence"),
    baseCredits: integer("base_credits").notNull().default(0),
    streakCredits: integer("streak_credits").notNull().default(0),
    masteryCredits: integer("mastery_credits").notNull().default(0),
    streak: integer("streak").notNull().default(0),
  },
  (t) => [
    index("learning_user_date").on(t.userId, t.createdAt),
    index("learning_user_word").on(t.userId, t.wordId),
    /**
     * Covers the per-word first and last day lookup that every practice request
     * makes. Without the day in the index, SQLite had to fetch every matching
     * row to read it, so the practice endpoint got slower the longer a child
     * had used the app.
     */
    index("learning_user_word_day").on(t.userId, t.wordId, t.day),
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
    stories: integer("stories").notNull().default(0),
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
    mastered: integer("mastered").notNull().default(0),
    /** Correct answers in a row, any speed. Cleared by a mistake, reveal or clue. */
    run: integer("run").notNull().default(0),
    /** Correct answers in the current run that also read as real recall. */
    recalls: integer("recalls").notNull().default(0),
    /** Superseded by run/recalls; kept so existing deployments never rewrite the table. */
    fastStreak: integer("fast_streak").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    /**
     * The reporting day this word was last shown, as a YYYY-MM-DD string.
     *
     * The app can already say "that is your fifth look at this word", which is
     * feedback the child can check. This adds the half that matters more: how
     * long ago it was. "You last saw this eleven days ago and it stayed" is the
     * only line in the app that shows a child that spacing out is working, and
     * spacing out is the entire method. The attempts table cannot be used
     * instead, because retired attempts are pruned.
     */
    lastSeen: text("last_seen"),
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

export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(),
  level: integer("level").notNull(),
  number: integer("number").notNull(),
  content: text("content").notNull(),
});
export const storyReads = sqliteTable(
  "story_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    startedAt: integer("started_at").notNull(),
    seconds: integer("seconds").notNull().default(0),
    paragraph: integer("paragraph").notNull().default(0),
    fraction: integer("fraction").notNull().default(0),
    bookmarkRevision: integer("bookmark_revision").notNull().default(0),
    bookmarkedAt: integer("bookmarked_at").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storyId] })],
);
export const storyTicks = sqliteTable("story_ticks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  storyId: text("story_id")
    .notNull()
    .references(() => stories.id),
  seconds: integer("seconds").notNull(),
  createdAt: integer("created_at").notNull(),
  day: text("day").notNull(),
  previousDay: text("previous_day").notNull(),
  sinceMidnight: integer("since_midnight").notNull(),
});
export const storyCompletions = sqliteTable(
  "story_completions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    createdAt: integer("created_at").notNull(),
    day: text("day").notNull(),
  },
  (t) => [uniqueIndex("story_completion_once").on(t.userId, t.storyId)],
);

export const readingPreferences = sqliteTable("reading_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(1),
  revision: integer("revision").notNull().default(0),
});
export const dailyStoryFinishes = sqliteTable(
  "daily_story_finishes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    day: text("day").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storyId, t.day] })],
);

/** Words a parent has removed from their child's practice and word list. */
export const wordExclusions = sqliteTable(
  "word_exclusions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: text("word_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wordId] })],
);

/**
 * Password recovery, one live link per account.
 *
 * `tokenHash` is the sha256 of the token the parent was emailed, never the token
 * itself, so a copy of the database is not a list of links that still work.
 * `expiresAt` is read in the lookup rather than by a sweeper, which is what
 * makes it safe to leave the purge to whoever gets round to it.
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** When the link stops working, as epoch milliseconds. One hour. */
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    /** Unique, so one token cannot back two rows and be spent twice. */
    uniqueIndex("password_reset_token").on(t.tokenHash),
    /** Serves retiring an account's previous link when a new one is asked for. */
    index("password_resets_user").on(t.userId),
    /** Serves clearing rows that can no longer be used. */
    index("password_resets_expiry").on(t.expiresAt),
  ],
);

/**
 * Address confirmation, one live link per account.
 *
 * The same shape as `password_resets` and for the same reasons: `tokenHash` is
 * the sha256 of the token the parent was emailed, never the token itself, so a
 * copy of the database is not a list of links that still work; the expiry is read
 * in the lookup rather than by a sweeper, so an un-swept table cannot be read as
 * permission; and the unique index is what stops one token backing two rows and
 * outliving the single use it was issued for.
 */
export const emailVerifications = sqliteTable(
  "email_verifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /**
     * When the link stops working, as epoch milliseconds. A day, rather than the
     * hour a password reset gets, because this may be the first message this
     * address has ever received: it has to survive an evening in a parent's
     * inbox and a weekend, and it is the only way into the account.
     */
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    /** Unique, so one token cannot back two rows and be spent twice. */
    uniqueIndex("email_verification_token").on(t.tokenHash),
    /** Serves retiring an account's previous link when a new one is asked for. */
    index("email_verifications_user").on(t.userId),
    /** Serves clearing rows that can no longer be used. */
    index("email_verifications_expiry").on(t.expiresAt),
  ],
);

/** Words a parent has added for their own child to practise. */
export const customWords = sqliteTable(
  "custom_words",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
    definition: text("definition").notNull(),
    example: text("example").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("custom_words_user_word").on(t.userId, t.word),
    check("custom_words_word_present", sql`length(trim(${t.word})) > 0`),
    check(
      "custom_words_definition_present",
      sql`length(trim(${t.definition})) > 0`,
    ),
  ],
);
