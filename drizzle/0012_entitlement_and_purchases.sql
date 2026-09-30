-- Entitlement as one column, purchases as an auditable ledger, and redemption
-- moved out of SQL triggers into one explicit batch.
--
-- Background: access used to be inferred by querying `subscriptions` on every
-- request for a row matching the configured price, inside a validity window.
-- That is a join-shaped question asked on the hot path to answer a question
-- with a boolean answer. The webhook is the only thing that legitimately
-- changes an entitlement, so it now writes a single `users.expiry_date`, and
-- `purchases` keeps the history of how it got there.

ALTER TABLE users ADD COLUMN expiry_date INTEGER;
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/London';

-- Streak lived on the credit wallet, which the trigger maintained. It is a
-- property of the child, not of the purse, and a redemption debits the purse
-- without touching the streak, so it belongs beside the account.
ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0;

-- The purchase ledger. One row per entitlement change, written by the webhook.
--
-- `confirmation` is UNIQUE and that is the whole point of the table: it is the
-- idempotency key for a replayed Stripe webhook. Stripe retries deliveries, and
-- without a unique constraint a retry would grant the same purchase twice.
-- `original_expiry`/`new_expiry` make the change legible to a parent disputing
-- it, and `status` is what a refund needs - a date alone cannot say "refunded"
-- or "cancelled but paid until Friday".
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  confirmation TEXT NOT NULL,
  original_expiry INTEGER,
  new_expiry INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_confirmation ON purchases(confirmation);
CREATE INDEX IF NOT EXISTS purchases_user ON purchases(user_id, created_at);

-- Backfill, so an account that has already paid does not lose access between
-- the deploy and its next webhook. The window below is deliberately the same
-- one `membership()` used: a row that was active and unexpired at migration
-- time becomes the new expiry, and everyone else gets NULL, which the trial
-- calculation continues to handle.
UPDATE users SET expiry_date = (
  SELECT MAX(s.period_end) * 1000 FROM subscriptions s
  WHERE s.user_id = users.id
    AND s.status IN ('active','trialing')
    AND s.period_end > unixepoch()
    AND s.price_id <> ''
);

-- Redemption no longer depends on SQL triggers.
--
-- `redeem_badge` raised INSUFFICIENT_CREDITS from a BEFORE INSERT trigger and
-- `badge_receipt` debited the wallet from an AFTER INSERT one. That is a real
-- guarantee - the check and the debit happen inside one statement, so two
-- concurrent redemptions cannot both pass - but the rule lived in SQL where
-- nothing in this repository could read it, and the amount was applied by a
-- trigger nobody calls. The application now does it in one batch: a conditional
-- UPDATE that only fires when the balance covers the cost, then the receipt and
-- the ledger row. Still one transaction, still impossible to overdraw, and the
-- `wallet_nonnegative` CHECK on credit_wallets remains the last line of defence.
DROP TRIGGER IF EXISTS redeem_badge;
DROP TRIGGER IF EXISTS badge_receipt;
--> statement-breakpoint
