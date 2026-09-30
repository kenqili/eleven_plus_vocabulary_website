-- Tell D1's migration ledger about migrations that were applied by hand.
--
-- Run this ONCE, on a database that was migrated with `wrangler d1 execute
-- --file`, before the first `wrangler d1 migrations apply`.
--
-- WHY
--
-- `d1 migrations apply` reads a `d1_migrations` table and runs whatever in the
-- migrations directory is not listed there. Migrations applied with
-- `d1 execute --file` left no record, so the ledger is empty and the first apply
-- would try to run all fourteen from the start - stopping on the first
-- `ALTER TABLE` whose column is already there. Nothing is damaged; the deploy
-- simply cannot pass until the ledger is seeded.
--
-- IF THE DATABASE HAS ONLY EVER BEEN MIGRATED BY scripts/deploy.sh, DO NOT RUN
-- THIS. The ledger is already right, and this would mark migrations as applied
-- that never ran - a schema change that will never be made, failing silently
-- forever after.
--
-- WHAT MAKES IT SAFE TO RUN
--
-- The four migrations this actually matters for are inserted only if their
-- effects are found in the database. A row cannot be added for a migration that
-- did not run, so the mistake the file could otherwise cause - claiming 0012 was
-- applied to a database that has no `users.expiry_date` - is not available here.
-- 0000 to 0009 predate the ledger, are inserted unconditionally, and are gated
-- on the database having a `users` table at all, which nothing that is not this
-- application's database would.
--
-- The final query is the check: every row should read `matches`.

CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- A database with no users table is not this application's database, or is a
-- brand new one. Either way, recording fourteen migrations against it is wrong,
-- and failing here is much better than a ledger full of things that never ran.
--
-- A CHECK constraint is how plain SQL gets an abort: SQLite's `RAISE` only works
-- inside a trigger, and dividing by zero returns NULL rather than erroring, which
-- is a silent no-op - which is the one thing this line must not be.
CREATE TEMP TABLE _must_have_users (present INTEGER NOT NULL CHECK (present = 1));
INSERT INTO _must_have_users (present)
  SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='users');
DROP TABLE _must_have_users;

-- 0000 to 0009. Every database this application has ever served ran these, and
-- there is no cheap way to verify each one's effect, so they are taken on trust
-- behind the check above.
INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES
  ('0000_gray_mandrill.sql',          CURRENT_TIMESTAMP),
  ('0001_orange_jocasta.sql',          CURRENT_TIMESTAMP),
  ('0002_brainy_famine.sql',           CURRENT_TIMESTAMP),
  ('0003_ordinary_edwin_jarvis.sql',   CURRENT_TIMESTAMP),
  ('0004_superb_the_fallen.sql',       CURRENT_TIMESTAMP),
  ('0005_perpetual_hercules.sql',      CURRENT_TIMESTAMP),
  ('0006_dazzling_doctor_faustus.sql', CURRENT_TIMESTAMP),
  ('0007_long_human_torch.sql',        CURRENT_TIMESTAMP),
  ('0008_square_metal_master.sql',     CURRENT_TIMESTAMP),
  ('0009_white_ricochet.sql',          CURRENT_TIMESTAMP);

-- 0010 to 0013, each recorded only if the schema says it ran.
--
-- 0011 changes data rather than shape, so there is nothing to inspect; it is
-- recorded on the strength of 0010 having run, which is the migration immediately
-- before it and the one a database at 0009 would be missing. A database that has
-- 0010 but not 0011 is not a state this repository can produce.
INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  SELECT '0010_coach_last_seen.sql', CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM pragma_table_info('progress') WHERE name='last_seen');

INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  SELECT '0011_reconcile_mastered_totals.sql', CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM pragma_table_info('progress') WHERE name='last_seen');

INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  SELECT '0012_entitlement_and_purchases.sql', CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='expiry_date')
     AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchases');

INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  SELECT '0013_password_reset.sql', CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='password_resets');

-- The check. Every row should read `matches`; a row reading `MISSING` means that
-- migration was not applied, which is correct - it is now pending, and the next
-- `d1 migrations apply` will run it.
SELECT m.name AS migration,
       CASE
         WHEN m.name = '0010_coach_last_seen.sql'
              THEN IF(EXISTS (SELECT 1 FROM pragma_table_info('progress') WHERE name='last_seen'),
                      'matches', 'MISSING - will be applied by the next deploy')
         WHEN m.name = '0011_reconcile_mastered_totals.sql'
              THEN IF(EXISTS (SELECT 1 FROM pragma_table_info('progress') WHERE name='last_seen'),
                      'matches', 'MISSING - will be applied by the next deploy')
         WHEN m.name = '0012_entitlement_and_purchases.sql'
              THEN IF(EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='expiry_date')
                      AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchases'),
                      'matches', 'MISSING - will be applied by the next deploy')
         WHEN m.name = '0013_password_reset.sql'
              THEN IF(EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='password_resets'),
                      'matches', 'MISSING - will be applied by the next deploy')
         ELSE 'pre-dates the ledger; taken on trust'
       END AS verdict
  FROM d1_migrations m
 ORDER BY m.name;
