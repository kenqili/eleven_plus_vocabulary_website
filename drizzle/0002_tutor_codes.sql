-- Tutor discount codes.
--
-- A tutor gets a code (TUTOR-NAME-20) that takes 20% off the yearly term for
-- their students. The money math lives in Stripe (one shared 20%-off coupon,
-- one promotion code per tutor); these tables hold the mapping and the
-- redemption count, so the private split with each tutor can be worked out
-- from our own ledger rather than from anyone's memory of the Stripe
-- dashboard.
--
-- On `tutors`. Who the code belongs to, and whether they are still someone we
-- work with. No commission columns: the split is settled privately, so the
-- system records redemptions, not money owed. A second table for payouts would
-- be a system with no second user to justify it - the payout is a bank
-- transfer and a conversation, and neither belongs in this database.
--
-- On `tutor_codes`. One row per issued code. `tier` is the only term a code
-- may discount, because a code that quietly worked on every tier would be a
-- 20% cut to the monthly price nobody agreed to. `status` rather than a
-- nullable `expires_at` as the record of whether a code is usable: expiry is
-- a date the code outlives, suspension is a decision, and a nullable column
-- makes those two answerable two ways. `stripe_promotion_code_id` is what the
-- checkout attaches, and Stripe itself enforces `max_redemptions` and expiry
-- at payment time, so a code that is oversold here is still capped there.
--
-- On `tutor_redemptions`. One row per paid referral, keyed on the payment
-- intent. The count a tutor is shown is COUNT(*) over their codes, never a
-- cached number: a cached count and the rows can disagree, and the rows are
-- the audit. The UNIQUE index on `payment_intent` is what makes a redelivered
-- webhook recover a lost count instead of doubling one - the same shape the
-- `purchases` ledger uses for the same reason.
CREATE TABLE tutors (
  id TEXT PRIMARY KEY,
  -- Who this is, as the admin page shows them. Not unique: two tutors can
  -- share a name, and the code label is what distinguishes them.
  name TEXT NOT NULL,
  -- How to reach them about renewals and splits. Free text, because it may be
  -- an email, a phone number, or a school office.
  contact TEXT,
  -- 'active' or 'suspended'. Not a boolean, so an unexpected third value is
  -- visible in the data rather than silently reading as false.
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE tutor_codes (
  id TEXT PRIMARY KEY,
  tutor_id TEXT NOT NULL REFERENCES tutors(id) ON DELETE CASCADE,
  -- The code as the parent types it: upper case, hyphens kept, TUTOR- prefix
  -- enforced at issue. See lib/server/tutor-codes.ts for the shape rules.
  label TEXT NOT NULL,
  -- The only term this code discounts. 'yearly' for every code issued so far;
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
  -- call to show a discounted price.
  percent_off INTEGER NOT NULL,
  -- How many students may use it before Stripe refuses it. Agreed per code at
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

CREATE UNIQUE INDEX tutor_code_label ON tutor_codes(label);
CREATE INDEX tutor_codes_tutor ON tutor_codes(tutor_id);

CREATE TABLE tutor_redemptions (
  id TEXT PRIMARY KEY,
  tutor_code_id TEXT NOT NULL REFERENCES tutor_codes(id) ON DELETE CASCADE,
  -- Who paid with it. Null only if the account is gone: the row is still the
  -- count, and deleting it would understate what the tutor earned.
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- The Stripe payment intent, which is unique per payment and unique here, so
  -- a redelivered webhook collapses onto the same row instead of counting twice.
  payment_intent TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX tutor_redemption_payment ON tutor_redemptions(payment_intent);
CREATE INDEX tutor_redemptions_code ON tutor_redemptions(tutor_code_id);
