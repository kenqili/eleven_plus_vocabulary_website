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
--> statement-breakpoint
