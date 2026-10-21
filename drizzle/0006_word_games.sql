-- Five Letters, one round per account.
--
-- The answer (`word_id`) is a bank id and is secret until the round ends. The
-- partial unique index is the interesting line: it is what makes "one active
-- game" a database fact, so two tabs cannot start two answers and then each
-- count progress against a different word. Finished rows stay as the recent
-- list and as the idempotency record for a retried guess.
--
-- `score_penalty` is separate from the derived placement score. A hint has to
-- survive a change in the word mix, and subtracting it from the stored score
-- would have made the 10,000 total drift for reasons no one could reconstruct.

ALTER TABLE users ADD COLUMN score_penalty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE word_games (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '[]',
  hints TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'playing',
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  answer_newly_mastered INTEGER NOT NULL DEFAULT 0,
  answer_already_mastered INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX word_games_one_active
  ON word_games(user_id)
  WHERE status = 'playing';

CREATE INDEX word_games_recent ON word_games(user_id, created_at);
