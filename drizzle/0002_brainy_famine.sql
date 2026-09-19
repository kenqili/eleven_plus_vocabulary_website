ALTER TABLE `attempts` ADD `question_type` text DEFAULT 'def' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` ADD `answer` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `prompt` text;