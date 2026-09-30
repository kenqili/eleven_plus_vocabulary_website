-- Confirm that an address belongs to whoever signed up, before the account is
-- usable.
--
-- Background: nothing checked that a parent could receive mail at the address
-- they gave. A regex cannot do that - only a confirmation can. The failure it
-- allowed is quiet and severe: a parent mistypes their address, practises for the
-- seven-day trial, and then discovers at the worst moment that they can never
-- recover the account and there is no one to ask. The only symptom from outside is
-- that a password reset never arrives.
--
-- `email_verified_at` is null until a link sent to the address has been opened.
-- Sign-in is refused while it is null, so an account nobody can reach mail at is
-- never a usable account.
--
-- The backfill matters more than the column. These accounts predate the feature
-- and have been used: a parent chose the address, practised on it, and may have
-- progress and badges. Refusing sign-in for all of them on deploy would lock out
-- every existing customer, and - because a password reset is also refused while
-- unverified - there would be no way back in at all. So they are stamped verified
-- at their own creation time, which records the weaker truth honestly: we are
-- taking the address on trust for accounts that already exist, not claiming to
-- have checked it. The alternative is not a stricter policy, it is data loss.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One live link per account, on the same shape as `password_resets` and for the
-- same reasons: `token_hash` is the sha256 of what was emailed and never the
-- token itself, so a copy of the database is not a list of links that still work;
-- the expiry is read in the lookup rather than swept, so an un-swept table cannot
-- be read as permission; and the unique index means one token cannot back two rows
-- and outlive the single use it was issued for.
--
-- A day, not an hour. This link is the only way into a new account, and unlike a
-- password reset it may be the first mail the address has ever received - so it
-- has to survive an evening in a parent's inbox and a weekend.
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications(expires_at);
