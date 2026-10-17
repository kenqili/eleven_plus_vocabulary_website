-- The codes tables, named for what they hold.
--
-- A promotion voucher sits in the same table as a tutor's code, so `tutor_codes`
-- was a name that stopped being true the moment the second kind existed.
-- `discount_codes` and `discount_redemptions` say what they are; `tutors` keeps
-- its name, because it still holds exactly tutors and a NULL `tutor_id` is the
-- record that a code is ours.
--
-- Rebuilt rather than renamed. `ALTER TABLE ... RENAME TO` rewrites the foreign
-- key that `tutor_redemptions` holds against `tutor_codes` only when SQLite is
-- not in legacy_alter_table mode, and a migration whose correctness depends on a
-- pragma default is a migration waiting to break on the next engine. Creating
-- the new tables, copying, then dropping the old ones does the same job with no
-- such dependency.
--
-- The drop order is not cosmetic. DROP TABLE on a parent fires ON DELETE CASCADE
-- into every child that references it, so the child goes first - by then the
-- only child that exists references the new table, not the one being dropped.
--
-- The copies are written even though both tables were empty in production when
-- this ran (checked immediately before the deploy; the voucher feature had
-- shipped without a code ever being issued). A database that does have rows
-- survives this; that is the point of copying rather than recreating.
CREATE TABLE discount_codes (
  id TEXT PRIMARY KEY,
  -- Null when the code is ours, as in 0003.
  tutor_id TEXT REFERENCES tutors(id) ON DELETE CASCADE,
  -- The code as the parent types it: upper case, hyphens kept.
  label TEXT NOT NULL,
  -- The only term any code discounts. 'yearly' for every code so far.
  tier TEXT NOT NULL DEFAULT 'yearly',
  stripe_coupon_id TEXT NOT NULL,
  stripe_promotion_code_id TEXT NOT NULL,
  percent_off INTEGER NOT NULL,
  max_redemptions INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
INSERT INTO discount_codes
  (id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at)
SELECT
  id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at
  FROM tutor_codes;

CREATE TABLE discount_redemptions (
  id TEXT PRIMARY KEY,
  discount_code_id TEXT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_intent TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO discount_redemptions
  (id,discount_code_id,user_id,payment_intent,created_at)
SELECT
  id,tutor_code_id,user_id,payment_intent,created_at
  FROM tutor_redemptions;

DROP TABLE tutor_redemptions;
DROP TABLE tutor_codes;

CREATE UNIQUE INDEX discount_code_label ON discount_codes(label);
CREATE INDEX discount_codes_tutor ON discount_codes(tutor_id);
CREATE UNIQUE INDEX discount_redemption_payment ON discount_redemptions(payment_intent);
CREATE INDEX discount_redemptions_code ON discount_redemptions(discount_code_id);
