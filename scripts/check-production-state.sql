-- Where does this database actually stand?
--
-- Paste into `wrangler d1 execute` (remote) to find out which migrations have
-- been applied, without running anything. Every part is a `pragma_table_info`
-- lookup rather than a `SELECT` of the column itself, because asking for a
-- column that does not exist is an error and this query has to survive that.
--
-- A column is reported as present only if it is in the table, so a partial
-- migration shows up rather than hiding behind a table that exists.
--
-- Expected on a fully migrated database: every row `present`.
-- If `users.expiry_date` reads `MISSING`, the signed-in app cannot work: the
-- column is read on every authenticated request, and a column that does not
-- exist is an error rather than a null.

SELECT 'users.expiry_date' AS item,
       CASE WHEN EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='expiry_date')
            THEN 'present' ELSE 'MISSING - from 0012' END AS state
UNION ALL SELECT 'users.timezone',
       CASE WHEN EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='timezone')
            THEN 'present' ELSE 'MISSING - from 0012' END
UNION ALL SELECT 'users.streak',
       CASE WHEN EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='streak')
            THEN 'present (unused: the streak lives on credit_wallets)' ELSE 'MISSING - from 0012' END
UNION ALL SELECT 'users.best_streak',
       CASE WHEN EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='best_streak')
            THEN 'present (unused: see users.streak)' ELSE 'MISSING - from 0012' END
UNION ALL SELECT 'progress.last_seen',
       CASE WHEN EXISTS (SELECT 1 FROM pragma_table_info('progress') WHERE name='last_seen')
            THEN 'present' ELSE 'MISSING - from 0010' END
UNION ALL SELECT 'table purchases',
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchases')
            THEN 'present' ELSE 'MISSING - from 0012' END
UNION ALL SELECT 'table password_resets',
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='password_resets')
            THEN 'present' ELSE 'MISSING - from 0013' END
UNION ALL SELECT 'trigger redeem_badge (should be gone)',
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='redeem_badge')
            THEN 'STILL PRESENT - 0012 has not been applied' ELSE 'dropped, as 0012 does' END
UNION ALL SELECT 'table subscriptions (0012 backfill reads it)',
       CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='subscriptions')
            THEN 'present' ELSE 'MISSING - 0012 WILL FAIL without it' END;
