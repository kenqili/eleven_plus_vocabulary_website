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
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_words_user_word` ON `custom_words` (`user_id`,`word`);--> statement-breakpoint
CREATE TABLE `word_exclusions` (
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `word_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
