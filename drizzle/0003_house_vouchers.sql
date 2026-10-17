-- Our own vouchers.
--
-- A voucher we issue for a promotion is the same machine as a tutor's code with
-- one difference: it belongs to us. So the change is that
-- `tutor_codes.tutor_id` becomes nullable, and NULL is the record that the code
-- is ours. No `kind` or `issuer` column beside it, because a second way to say
-- the same thing is a second way to disagree with the first, and the foreign key
-- is already the fact: there is no tutor, so it is ours.
--
-- This is the block the whole file exists for, and it is why both tables are
-- recreated. SQLite cannot drop NOT NULL from an existing column, so the table
-- is rewritten; and `tutor_redemptions` is rewritten with it because its
-- foreign key points at `tutor_codes`, and SQLite's DROP TABLE performs an
-- implicit DELETE FROM on the parent that fires ON DELETE CASCADE into the
-- child. Dropping the child first, then the parent, then creating both afresh
-- in the order below, is what keeps that cascade from ever running.
--
-- Nothing is copied, and that is a measurement rather than a hope: both tables
-- held zero rows when this was written, checked against production, because the
-- feature had shipped without a code having been issued. Recreated rather than
-- migrated is therefore lossless here, and simpler than a copy whose direction
-- the cascade rule would have to be reasoned about twice.
--
-- A database built from scratch gets the same two tables in the same shape -
-- 0002 creates them, this drops and recreates them - so the sequence is safe to
-- replay, which is the only property the ledger and a fresh deploy both need.
DROP TABLE tutor_redemptions;
DROP TABLE tutor_codes;

CREATE TABLE tutor_codes (
  id TEXT PRIMARY KEY,
  -- Null when the code is ours rather than a tutor's. The rest of the row is
  -- identical either way: our vouchers are discounted, capped, expired and
  -- counted by the same code path, and a promotion is the same thing as a
  -- tutor's code from the parent's side.
  tutor_id TEXT REFERENCES tutors(id) ON DELETE CASCADE,
  -- The code as the parent types it: upper case, hyphens kept. Tutor codes
  -- carry a TUTOR- prefix; ours are named after the promotion. See
  -- lib/server/tutor-codes.ts for the shape rules.
  label TEXT NOT NULL,
  -- The only term any code discounts. 'yearly' for every code issued so far;
  -- a column rather than a constant so a future term does not need a schema
  -- change to be offered one.
  tier TEXT NOT NULL DEFAULT 'yearly',
  -- The Stripe objects that do the money math. Stored, not derived, because
  -- the dashboard is where they can be inspected and revoked, and an id kept
  -- here is what ties that inspection to this row.
  stripe_coupon_id TEXT NOT NULL,
  stripe_promotion_code_id TEXT NOT NULL,
  -- Whole percent, so 20 means twenty percent off. Stored on the row rather
  -- than read off Stripe at display time, so the account page costs no Stripe
  -- call to show a discounted price. Ours and a tutor's may differ: the
  -- percent is per code, and each percent gets its own Stripe coupon.
  percent_off INTEGER NOT NULL,
  -- How many families may use it before Stripe refuses it. Agreed per code at
  -- issue; 100 is the default, not a rule.
  max_redemptions INTEGER NOT NULL,
  -- Epoch milliseconds. Stripe enforces this at payment time too, so a code
  -- that outlives its row is still capped there.
  expires_at INTEGER NOT NULL,
  -- 'active' or 'suspended'. Suspended codes fail validation here, before
  -- Stripe is ever asked.
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE tutor_redemptions (
  id TEXT PRIMARY KEY,
  tutor_code_id TEXT NOT NULL REFERENCES tutor_codes(id) ON DELETE CASCADE,
  -- Who paid with it. Null only if the account is gone: the row is still the
  -- count, and deleting it would understate what the tutor earned. A code of
  -- ours has a count with nobody to settle with, and is still kept: it is how
  -- many families a promotion reached.
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- The Stripe payment intent, which is unique per payment and unique here, so
  -- a redelivered webhook collapses onto the same row instead of counting twice.
  payment_intent TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX tutor_code_label ON tutor_codes(label);
CREATE INDEX tutor_codes_tutor ON tutor_codes(tutor_id);
CREATE UNIQUE INDEX tutor_redemption_payment ON tutor_redemptions(payment_intent);
CREATE INDEX tutor_redemptions_code ON tutor_redemptions(tutor_code_id);
