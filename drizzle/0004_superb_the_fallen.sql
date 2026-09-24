CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`number` integer NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`day` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_completion_once` ON `story_completions` (`user_id`,`story_id`);--> statement-breakpoint
CREATE TABLE `story_reads` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE `daily_stats` ADD `stories` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER story_tick_totals AFTER INSERT ON story_ticks BEGIN
  UPDATE story_reads SET seconds=seconds+NEW.seconds WHERE user_id=NEW.user_id AND story_id=NEW.story_id;
  INSERT INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight)
    VALUES(NEW.id,NEW.user_id,NEW.created_at,NEW.seconds,NEW.day,NEW.previous_day,NEW.since_midnight);
END;
--> statement-breakpoint
CREATE TRIGGER story_read_award AFTER INSERT ON story_completions BEGIN
  INSERT OR IGNORE INTO credit_wallets(user_id) VALUES(NEW.user_id);
  UPDATE credit_wallets SET balance=balance+10 WHERE user_id=NEW.user_id;
  INSERT INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
    SELECT 'story:'||NEW.id,NEW.user_id,10,'story',NEW.story_id,balance,NEW.created_at FROM credit_wallets WHERE user_id=NEW.user_id;
  INSERT INTO daily_stats(user_id,day,stories,credits) VALUES(NEW.user_id,NEW.day,1,10)
    ON CONFLICT(user_id,day) DO UPDATE SET stories=stories+1,credits=credits+10;
END;
