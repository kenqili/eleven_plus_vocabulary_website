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
--> statement-breakpoint
CREATE INDEX `credit_history` ON `credit_transactions` (`user_id`,`created_at`);--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `learning_user_date` ON `learning_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `learning_user_word` ON `learning_events` (`user_id`,`word_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `redemption_request` ON `badge_redemptions` (`user_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `redemption_history` ON `badge_redemptions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `study_clock` (
	`user_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `study_tick_history` ON `study_ticks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`best_streak` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_nonnegative" CHECK("credit_wallets"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `rewards_initialized` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER learning_awards AFTER INSERT ON learning_events BEGIN
  INSERT OR IGNORE INTO credit_wallets(user_id) VALUES(NEW.user_id);
  UPDATE credit_wallets SET streak= CASE WHEN NEW.correct=0 THEN 0 WHEN NEW.eligible=1 THEN streak+1 ELSE streak END WHERE user_id=NEW.user_id;
  UPDATE credit_wallets SET best_streak=MAX(best_streak,streak) WHERE user_id=NEW.user_id;
  UPDATE learning_events SET
    base_credits= CASE WHEN NEW.correct=1 AND NEW.eligible=1 THEN 2 ELSE 0 END ,
    streak_credits= CASE WHEN NEW.correct=1 AND NEW.eligible=1 AND (SELECT streak FROM credit_wallets WHERE user_id=NEW.user_id)%3=0 THEN 5 ELSE 0 END ,
    mastery_credits= CASE WHEN NEW.mastered=1 THEN 10 ELSE 0 END ,
    streak=(SELECT streak FROM credit_wallets WHERE user_id=NEW.user_id)
    WHERE attempt_id=NEW.attempt_id;
  UPDATE credit_wallets SET balance=balance+(SELECT base_credits+streak_credits+mastery_credits FROM learning_events WHERE attempt_id=NEW.attempt_id) WHERE user_id=NEW.user_id;
  INSERT INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
    SELECT 'answer:'||attempt_id,user_id,base_credits+streak_credits+mastery_credits,'learning',attempt_id,
      (SELECT balance FROM credit_wallets WHERE user_id=NEW.user_id),created_at
    FROM learning_events WHERE attempt_id=NEW.attempt_id AND base_credits+streak_credits+mastery_credits>0;
  INSERT INTO daily_stats(user_id,day,questions,correct,reveals,new_words,mastered,credits)
    SELECT user_id,day,1,correct,revealed,
      CASE WHEN (SELECT COUNT(*) FROM learning_events WHERE user_id=NEW.user_id AND word_id=NEW.word_id)=1 THEN 1 ELSE 0 END ,
      mastered,base_credits+streak_credits+mastery_credits FROM learning_events WHERE attempt_id=NEW.attempt_id
    ON CONFLICT(user_id,day) DO UPDATE SET questions=questions+1,correct=correct+excluded.correct,reveals=reveals+excluded.reveals,new_words=new_words+excluded.new_words,mastered=mastered+excluded.mastered,credits=credits+excluded.credits;
END;
--> statement-breakpoint
CREATE TRIGGER redeem_badge BEFORE INSERT ON badge_redemptions
WHEN NOT EXISTS(SELECT 1 FROM badge_redemptions WHERE user_id=NEW.user_id AND request_key=NEW.request_key)
BEGIN
  SELECT CASE WHEN NEW.cost<=0 OR COALESCE((SELECT balance FROM credit_wallets WHERE user_id=NEW.user_id),0)<NEW.cost THEN RAISE(ABORT,'INSUFFICIENT_CREDITS') END;
END;
--> statement-breakpoint
CREATE TRIGGER badge_receipt AFTER INSERT ON badge_redemptions BEGIN
  UPDATE credit_wallets SET balance=balance-NEW.cost WHERE user_id=NEW.user_id;
  INSERT INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
    SELECT 'redeem:'||NEW.id,NEW.user_id,-NEW.cost,'badge',NEW.id,balance,NEW.created_at FROM credit_wallets WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER study_tick_totals AFTER INSERT ON study_ticks BEGIN
  INSERT INTO daily_stats(user_id,day,seconds) VALUES(NEW.user_id,NEW.day,MIN(NEW.seconds,NEW.since_midnight))
    ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds;
  INSERT INTO daily_stats(user_id,day,seconds)
    SELECT NEW.user_id,NEW.previous_day,MAX(0,NEW.seconds-NEW.since_midnight) WHERE NEW.seconds>NEW.since_midnight
    ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds;
END;
