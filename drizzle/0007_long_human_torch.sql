ALTER TABLE `learning_events` ADD `evidence` text;--> statement-breakpoint
ALTER TABLE `progress` ADD `run` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `progress` ADD `recalls` integer DEFAULT 0 NOT NULL;