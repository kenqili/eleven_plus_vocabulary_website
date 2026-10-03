-- Admin, and coupons.
--
-- Two things, and they are here together only because both exist to serve one
-- person: a way to say which account is allowed to issue access, and the issued
-- codes themselves.
--
-- On `is_admin`. The alternative is a comparison against one email address in
-- every route that needs it, which fails in three ways at once. It puts a
-- credential in the source, where it is published and cannot be rotated without
-- a deploy. It makes the check ambient - the same test copied into each route,
-- with the guarantee that one of them will eventually forget it. And it ties
-- authority to an address, which a parent can change, so the day it is changed
-- the owner silently loses the ability to issue a code and nobody finds out
-- until a coupon is refused.
--
-- So the credential is a column, set once by hand, and the check is one helper
-- rather than a habit. It is a boolean rather than a table of administrators
-- because there is one administrator and a second table would be a system with
-- no second user to justify it.
--
-- On `coupons`. `status` rather than a nullable `user_id` as the record of
-- whether a code has been spent: a code that has been claimed by nobody has to
-- be distinguishable from one that has, and a nullable foreign key makes that
-- question answerable two ways - and the second of them is what a half-finished
-- claim looks like. `status` has one value to mean "unavailable" and the claim
-- updates it in the same statement that records who spent it, so the two cannot
-- disagree.
--
-- `days` rather than a number of months, because a month is not a number of
-- days and the two answers differ by up to three. Storing months would mean
-- every reader had to know which convention was meant, and "one year" would
-- quietly be 360 of them. The admin page offers fixed lengths and this stores
-- the answer.
--
-- Nothing here is secret and nothing is hashed. A coupon is a bearer token a
-- parent types in, so it has to be looked up by value, and its value is spent
-- rather than revealed - which is what `status` is for, and why redemption is a
-- single conditional update rather than a read followed by a write.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  -- The code as the parent types it: upper case, no punctuation. See
  -- lib/server/coupon.ts for why the alphabet and length are what they are.
  code TEXT NOT NULL,
  -- How much access this code buys, in days.
  days INTEGER NOT NULL,
  -- 'unused' or 'redeemed'. Not a boolean, so an unexpected third value is
  -- visible in the data rather than silently reading as false.
  status TEXT NOT NULL DEFAULT 'unused',
  -- Who spent it, and when. Null until spent.
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Which generation produced it, so a batch can be listed, counted or revoked
  -- without the codes having to be recognised by their shape.
  batch TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER
);

CREATE UNIQUE INDEX coupon_code ON coupons(code);
CREATE INDEX coupons_batch ON coupons(batch);
-- Redeeming is a lookup on this pair, and so is the claim itself, which is
-- conditional on `status`.
CREATE INDEX coupons_unspent ON coupons(status, code);