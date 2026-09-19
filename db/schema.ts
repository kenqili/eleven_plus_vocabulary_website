import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: integer("created_at").notNull(),
  customerId: text("customer_id").unique(),
});
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
