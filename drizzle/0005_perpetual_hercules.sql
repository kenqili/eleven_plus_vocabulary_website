CREATE TABLE `daily_story_finishes` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reading_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `story_reads` ADD `paragraph` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_reads` ADD `fraction` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_reads` ADD `bookmark_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_reads` ADD `bookmarked_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO daily_story_finishes(user_id,story_id,day,created_at)
SELECT user_id,story_id,day,created_at FROM story_completions;
