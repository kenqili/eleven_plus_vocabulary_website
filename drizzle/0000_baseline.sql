-- The whole schema, as one migration.
--
-- These were fifteen files, which is a history rather than a schema: each one
-- recorded what changed since the last, so a database built from them is an
-- ordering problem rather than a description of the tables it ends up with.
-- This file is that description, in the order the statements have to run. The
-- database is being emptied, so there is no history to preserve and nothing is
-- lost - only the story of how the schema got here, which is what the section
-- comments below record.
--
-- Hand-written, and it has to stay that way. drizzle-kit models tables and
-- columns only, so regenerating this file would silently drop all six triggers
-- - which award credits, and are the only thing that does. That is why this is
-- not a generated file and why regenerating it is not a repair.
--
-- The section comments are load-bearing. tests/helpers/migrations.mjs splits on
-- them so a test can apply the schema as it stood before one change and then
-- that change alone, which is the only way to test a backfill now that the
-- steps are no longer separate files. Keep one per section.
--
-- From here on, migrations are generated: `npm run db:generate` writes a new file
-- and adds it to drizzle/meta/_journal.json, which is how `d1 migrations apply`
-- finds them. Do not apply this file by hand - it records nothing, so the next
-- deploy would run it again from the top.

-- 0000_gray_mandrill

CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`choices` text NOT NULL,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	`selected` integer,
	`is_correct` integer,
	`elapsed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `attempts_user_created` ON `attempts` (`user_id`,`created_at`);
CREATE UNIQUE INDEX `attempts_one_pending_per_user` ON `attempts` (`user_id`) WHERE "attempts"."answered_at" IS NULL;
CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	PRIMARY KEY(`user_id`, `word_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);

CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `sessions_user` ON `sessions` (`user_id`);
CREATE INDEX `sessions_expiry` ON `sessions` (`expires_at`);
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`period_end` integer NOT NULL,
	`price_id` text NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `subscriptions_user` ON `subscriptions` (`user_id`);
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`created_at` integer NOT NULL,
	`customer_id` text
);

CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
CREATE UNIQUE INDEX `users_customer_id_unique` ON `users` (`customer_id`);
-- 0001_orange_jocasta

CREATE TABLE `checkout_requests` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`session_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

-- 0002_brainy_famine

ALTER TABLE `attempts` ADD `question_type` text DEFAULT 'def' NOT NULL;
ALTER TABLE `attempts` ADD `answer` text;
ALTER TABLE `attempts` ADD `prompt` text;
-- 0003_ordinary_edwin_jarvis

CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`reference` text NOT NULL,
	`rule_version` integer DEFAULT 1 NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `credit_history` ON `credit_transactions` (`user_id`,`created_at`);
CREATE TABLE `daily_stats` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`questions` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`reveals` integer DEFAULT 0 NOT NULL,
	`new_words` integer DEFAULT 0 NOT NULL,
	`mastered` integer DEFAULT 0 NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `learning_events` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`day` text NOT NULL,
	`correct` integer NOT NULL,
	`revealed` integer NOT NULL,
	`eligible` integer NOT NULL,
	`mastered` integer NOT NULL,
	`base_credits` integer DEFAULT 0 NOT NULL,
	`streak_credits` integer DEFAULT 0 NOT NULL,
	`mastery_credits` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `learning_user_date` ON `learning_events` (`user_id`,`created_at`);
CREATE INDEX `learning_user_word` ON `learning_events` (`user_id`,`word_id`);
CREATE TABLE `badge_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_key` text NOT NULL,
	`badge_id` text NOT NULL,
	`badge_name` text NOT NULL,
	`cost` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `redemption_request` ON `badge_redemptions` (`user_id`,`request_key`);
CREATE INDEX `redemption_history` ON `badge_redemptions` (`user_id`,`created_at`);
CREATE TABLE `study_clock` (
	`user_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `study_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`seconds` integer NOT NULL,
	`day` text NOT NULL,
	`previous_day` text NOT NULL,
	`since_midnight` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `study_tick_history` ON `study_ticks` (`user_id`,`created_at`);
CREATE TABLE `credit_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`best_streak` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_nonnegative" CHECK("credit_wallets"."balance" >= 0)
);

ALTER TABLE `users` ADD `rewards_initialized` integer DEFAULT 0 NOT NULL;
-- NO `CASE` IN A TRIGGER BODY. Read this before adding one.
--
-- `d1 migrations apply` sends each migration file to D1 as one string and lets
-- the *server* split it into statements, while `d1 execute --file` splits it
-- locally first. The local splitter understands `CASE ... END`; the server's
-- evidently does not, and it splits at a `;` that is really inside a trigger
-- body. The result is a truncated statement, and the error says only
-- "incomplete input" - which is why this file's first trigger used to stop every
-- deploy at 0003 while the same SQL applied cleanly by hand.
--
-- `BEGIN ... END` is unavoidable - that is what a trigger is. `CASE` is not, so
-- it is arithmetic instead: a SQLite boolean is 1 or 0, so `c*e` is "correct and
-- eligible", and `5*(c*e)*(streak%3=0)` is the same as the `CASE` it replaced.
-- Checked against the old expressions over every combination of correct,
-- eligible and mastered across ten streak values; they agree everywhere.
--
-- The three other triggers here have no `CASE` and never did. Keep it that way:
-- the reward logic in TypeScript is what these have to agree with, and
-- tests/credits.test.mjs compares the two answer for answer.
CREATE TRIGGER learning_awards AFTER INSERT ON learning_events BEGIN
  INSERT OR IGNORE INTO credit_wallets(user_id) VALUES(NEW.user_id);
  UPDATE credit_wallets SET streak=streak*NEW.correct+NEW.correct*NEW.eligible WHERE user_id=NEW.user_id;
  UPDATE credit_wallets SET best_streak=MAX(best_streak,streak) WHERE user_id=NEW.user_id;
  UPDATE learning_events SET
    base_credits= 2*(NEW.correct*NEW.eligible) ,
    streak_credits= 5*(NEW.correct*NEW.eligible)*((SELECT streak FROM credit_wallets WHERE user_id=NEW.user_id)%3=0) ,
    mastery_credits= 10*NEW.mastered ,
    streak=(SELECT streak FROM credit_wallets WHERE user_id=NEW.user_id)
    WHERE attempt_id=NEW.attempt_id;
  UPDATE credit_wallets SET balance=balance+(SELECT base_credits+streak_credits+mastery_credits FROM learning_events WHERE attempt_id=NEW.attempt_id) WHERE user_id=NEW.user_id;
  INSERT INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
    SELECT 'answer:'||attempt_id,user_id,base_credits+streak_credits+mastery_credits,'learning',attempt_id,
      (SELECT balance FROM credit_wallets WHERE user_id=NEW.user_id),created_at
    FROM learning_events WHERE attempt_id=NEW.attempt_id AND base_credits+streak_credits+mastery_credits>0;
  INSERT INTO daily_stats(user_id,day,questions,correct,reveals,new_words,mastered,credits)
    SELECT user_id,day,1,correct,revealed,
      ((SELECT COUNT(*) FROM learning_events WHERE user_id=NEW.user_id AND word_id=NEW.word_id)=1) ,
      mastered,base_credits+streak_credits+mastery_credits FROM learning_events WHERE attempt_id=NEW.attempt_id
    ON CONFLICT(user_id,day) DO UPDATE SET questions=questions+1,correct=correct+excluded.correct,reveals=reveals+excluded.reveals,new_words=new_words+excluded.new_words,mastered=mastered+excluded.mastered,credits=credits+excluded.credits;
END;

-- `redeem_badge` and `badge_receipt` used to be created here and dropped again
-- further down, when entitlement moved out of SQL triggers into the application.
-- A baseline is a description of the schema, not the story of how it got here,
-- and a trigger that is created and destroyed inside the same file is neither,
-- so neither is created. tests/entitlement.test.mjs asserts they are absent.

CREATE TRIGGER study_tick_totals AFTER INSERT ON study_ticks BEGIN
  INSERT INTO daily_stats(user_id,day,seconds) VALUES(NEW.user_id,NEW.day,MIN(NEW.seconds,NEW.since_midnight))
    ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds;
  INSERT INTO daily_stats(user_id,day,seconds)
    SELECT NEW.user_id,NEW.previous_day,MAX(0,NEW.seconds-NEW.since_midnight) WHERE NEW.seconds>NEW.since_midnight
    ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds;
END;

-- 0004_superb_the_fallen

CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`number` integer NOT NULL,
	`content` text NOT NULL
);

CREATE TABLE `story_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`day` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `story_completion_once` ON `story_completions` (`user_id`,`story_id`);
CREATE TABLE `story_reads` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `story_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`seconds` integer NOT NULL,
	`created_at` integer NOT NULL,
	`day` text NOT NULL,
	`previous_day` text NOT NULL,
	`since_midnight` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);

ALTER TABLE `daily_stats` ADD `stories` integer DEFAULT 0 NOT NULL;

CREATE TRIGGER story_tick_totals AFTER INSERT ON story_ticks BEGIN
  UPDATE story_reads SET seconds=seconds+NEW.seconds WHERE user_id=NEW.user_id AND story_id=NEW.story_id;
  INSERT INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight)
    VALUES(NEW.id,NEW.user_id,NEW.created_at,NEW.seconds,NEW.day,NEW.previous_day,NEW.since_midnight);
END;

CREATE TRIGGER story_read_award AFTER INSERT ON story_completions BEGIN
  INSERT OR IGNORE INTO credit_wallets(user_id) VALUES(NEW.user_id);
  UPDATE credit_wallets SET balance=balance+10 WHERE user_id=NEW.user_id;
  INSERT INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
    SELECT 'story:'||NEW.id,NEW.user_id,10,'story',NEW.story_id,balance,NEW.created_at FROM credit_wallets WHERE user_id=NEW.user_id;
  INSERT INTO daily_stats(user_id,day,stories,credits) VALUES(NEW.user_id,NEW.day,1,10)
    ON CONFLICT(user_id,day) DO UPDATE SET stories=stories+1,credits=credits+10;
END;

-- 0005_perpetual_hercules

CREATE TABLE `daily_story_finishes` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `reading_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

ALTER TABLE `story_reads` ADD `paragraph` integer DEFAULT 0 NOT NULL;
ALTER TABLE `story_reads` ADD `fraction` integer DEFAULT 0 NOT NULL;
ALTER TABLE `story_reads` ADD `bookmark_revision` integer DEFAULT 0 NOT NULL;
ALTER TABLE `story_reads` ADD `bookmarked_at` integer DEFAULT 0 NOT NULL;
INSERT OR IGNORE INTO daily_story_finishes(user_id,story_id,day,created_at)
SELECT user_id,story_id,day,created_at FROM story_completions;

-- 0006_dazzling_doctor_faustus

ALTER TABLE `progress` ADD `mastered` integer DEFAULT 0 NOT NULL;
ALTER TABLE `progress` ADD `fast_streak` integer DEFAULT 0 NOT NULL;

UPDATE progress SET mastered=1 WHERE correct>=5;

-- 0007_long_human_torch

ALTER TABLE `learning_events` ADD `evidence` text;
ALTER TABLE `progress` ADD `run` integer DEFAULT 0 NOT NULL;
ALTER TABLE `progress` ADD `recalls` integer DEFAULT 0 NOT NULL;
-- 0008_square_metal_master

CREATE TABLE `custom_words` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word` text NOT NULL,
	`definition` text NOT NULL,
	`example` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "custom_words_word_present" CHECK(length(trim("custom_words"."word")) > 0),
	CONSTRAINT "custom_words_definition_present" CHECK(length(trim("custom_words"."definition")) > 0)
);

CREATE UNIQUE INDEX `custom_words_user_word` ON `custom_words` (`user_id`,`word`);
CREATE TABLE `word_exclusions` (
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `word_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

-- 0009_white_ricochet

CREATE INDEX `learning_user_word_day` ON `learning_events` (`user_id`,`word_id`,`day`);
-- 0010_coach_last_seen

-- The reporting day a word was last shown, so the app can tell a child how long
-- ago it gave them that word. Attempts are pruned, so this has to live on the
-- progress row to survive. Nullable, and null for words not yet seen.
ALTER TABLE `progress` ADD `last_seen` text;

-- 0011_reconcile_mastered_totals

-- Reconciles the running "mastered" total for accounts that predate the
-- `progress.mastered` column.
--
-- Migration 0006 added the column and then backfilled it:
--
--   UPDATE progress SET mastered=1 WHERE correct>=5;
--
-- That set the per-word flags without writing a `learning_events` row, and
-- `daily_stats.mastered` is only ever incremented by the trigger on
-- `learning_events`. So for any account that had already been active before
-- 0006 applied, the word shelf (which reads each row) and the mission total
-- (which sums `daily_stats`) disagree by however many words that statement
-- flipped, and no later run of the app can correct it: mastery is monotonic,
-- so those words never produce another mastery event.
--
-- This adds only the shortfall. A word is counted here when its row says
-- mastered but no mastery event was ever recorded for it, which is precisely
-- the set 0006 invented. Words mastered through normal play, and words carried
-- in by the legacy importer, both have a mastery event and are left alone.
--
-- The `rewards_initialized` gate is what keeps this from double counting.
-- `learning_events` is backfilled lazily, the first time an account is used,
-- and that backfill writes mastery events of its own. An account not opened
-- since before the events table existed therefore has no events *yet*, not no
-- events *ever*, and counting it here would let the backfill count the same
-- words again the moment the child next opened the app. Only an account whose
-- backfill has already happened can be measured this way.
--
-- The day is the migration's own local date. It does not matter which day it
-- lands on: `daily_stats` is only ever summed for the lifetime total, and the
-- day is not used to work out when a word was mastered.
--
-- This is a one-off repair. Migrations are applied once, in filename order, by
-- the loop in docs/DEPLOY.md, so it cannot be applied twice by accident.
INSERT INTO daily_stats(user_id,day,mastered)
SELECT
  p.user_id,
  date('now','localtime'),
  COUNT(*)
FROM progress p
JOIN users u ON u.id = p.user_id
WHERE p.mastered=1
  AND u.rewards_initialized=1
  AND NOT EXISTS (
    SELECT 1
    FROM learning_events e
    WHERE e.user_id=p.user_id
      AND e.word_id=p.word_id
      AND e.mastered=1
  )
GROUP BY p.user_id
ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered;

-- 0012_entitlement_and_purchases

-- Entitlement as one column, purchases as an auditable ledger, and redemption
-- moved out of SQL triggers into one explicit batch.
--
-- Background: access used to be inferred by querying `subscriptions` on every
-- request for a row matching the configured price, inside a validity window.
-- That is a join-shaped question asked on the hot path to answer a question
-- with a boolean answer. The webhook is the only thing that legitimately
-- changes an entitlement, so it now writes a single `users.expiry_date`, and
-- `purchases` keeps the history of how it got there.

ALTER TABLE users ADD COLUMN expiry_date INTEGER;
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/London';

-- Streak lived on the credit wallet, which the trigger maintained. It is a
-- property of the child, not of the purse, and a redemption debits the purse
-- without touching the streak, so it belongs beside the account.
ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0;

-- The purchase ledger. One row per entitlement change, written by the webhook.
--
-- `confirmation` is UNIQUE and that is the whole point of the table: it is the
-- idempotency key for a replayed Stripe webhook. Stripe retries deliveries, and
-- without a unique constraint a retry would grant the same purchase twice.
-- `original_expiry`/`new_expiry` make the change legible to a parent disputing
-- it, and `status` is what a refund needs - a date alone cannot say "refunded"
-- or "cancelled but paid until Friday".
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  confirmation TEXT NOT NULL,
  original_expiry INTEGER,
  new_expiry INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_confirmation ON purchases(confirmation);
CREATE INDEX IF NOT EXISTS purchases_user ON purchases(user_id, created_at);

-- Backfill, so an account that has already paid does not lose access between
-- the deploy and its next webhook. The window below is deliberately the same
-- one `membership()` used: a row that was active and unexpired at migration
-- time becomes the new expiry, and everyone else gets NULL, which the trial
-- calculation continues to handle.
UPDATE users SET expiry_date = (
  SELECT MAX(s.period_end) * 1000 FROM subscriptions s
  WHERE s.user_id = users.id
    AND s.status IN ('active','trialing')
    AND s.period_end > unixepoch()
    AND s.price_id <> ''
);

-- Redemption no longer depends on SQL triggers.
--
-- `redeem_badge` raised INSUFFICIENT_CREDITS from a BEFORE INSERT trigger and
-- `badge_receipt` debited the wallet from an AFTER INSERT one. That is a real
-- guarantee - the check and the debit happen inside one statement, so two
-- concurrent redemptions cannot both pass - but the rule lived in SQL where
-- nothing in this repository could read it, and the amount was applied by a
-- trigger nobody calls. The application now does it in one batch: a conditional
-- UPDATE that only fires when the balance covers the cost, then the receipt and
-- the ledger row. Still one transaction, still impossible to overdraw, and the
-- `wallet_nonnegative` CHECK on credit_wallets remains the last line of defence.
-- Neither trigger is created or dropped here: it is created nowhere in this
-- file, so there is nothing to drop, and a schema description should not carry
-- the steps that removed it.


-- 0013_password_reset

-- Password recovery, as a single-use hashed token with an hour of life.
--
-- Background: a parent who cannot get back into their own account has no
-- remedy. Sign-in is the only door, and a forgotten password closed it. The
-- reset is deliberately not a stored question-and-answer or a support ticket:
-- a token that proves control of the mailbox is the same proof a password
-- itself is, so nothing here is a weaker version of signing in.
--
-- `token_hash` is the sha256 of the emailed token and never the token itself,
-- for the reason `sessions.token_hash` is: a copy of the database must not be a
-- list of working reset links. `expires_at` is enforced in the lookup query
-- rather than by a sweeper, so an un-swept table cannot be read as permission.

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- Unique, so a token cannot back two rows and outlive the single use it was
-- issued for. The user and expiry indexes serve the two other questions asked
-- of this table: retiring an account's previous link, and clearing dead rows.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS password_resets_expiry ON password_resets(expires_at);


-- 0014_email_verification

-- Confirm that an address belongs to whoever signed up, before the account is
-- usable.
--
-- Background: nothing checked that a parent could receive mail at the address
-- they gave. A regex cannot do that - only a confirmation can. The failure it
-- allowed is quiet and severe: a parent mistypes their address, practises for the
-- seven-day trial, and then discovers at the worst moment that they can never
-- recover the account and there is no one to ask. The only symptom from outside is
-- that a password reset never arrives.
--
-- `email_verified_at` is null until a link sent to the address has been opened.
-- Sign-in is refused while it is null, so an account nobody can reach mail at is
-- never a usable account.
--
-- The backfill matters more than the column. These accounts predate the feature
-- and have been used: a parent chose the address, practised on it, and may have
-- progress and badges. Refusing sign-in for all of them on deploy would lock out
-- every existing customer, and - because a password reset is also refused while
-- unverified - there would be no way back in at all. So they are stamped verified
-- at their own creation time, which records the weaker truth honestly: we are
-- taking the address on trust for accounts that already exist, not claiming to
-- have checked it. The alternative is not a stricter policy, it is data loss.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One live link per account, on the same shape as `password_resets` and for the
-- same reasons: `token_hash` is the sha256 of what was emailed and never the
-- token itself, so a copy of the database is not a list of links that still work;
-- the expiry is read in the lookup rather than swept, so an un-swept table cannot
-- be read as permission; and the unique index means one token cannot back two rows
-- and outlive the single use it was issued for.
--
-- A day, not an hour. This link is the only way into a new account, and unlike a
-- password reset it may be the first mail the address has ever received - so it
-- has to survive an evening in a parent's inbox and a weekend.
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications(expires_at);

