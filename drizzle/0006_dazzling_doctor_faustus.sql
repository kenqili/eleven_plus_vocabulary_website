ALTER TABLE `progress` ADD `mastered` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `progress` ADD `fast_streak` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE progress SET mastered=1 WHERE correct>=5;
