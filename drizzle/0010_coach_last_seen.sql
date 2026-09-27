-- The reporting day a word was last shown, so the app can tell a child how long
-- ago it gave them that word. Attempts are pruned, so this has to live on the
-- progress row to survive. Nullable, and null for words not yet seen.
ALTER TABLE `progress` ADD `last_seen` text;
