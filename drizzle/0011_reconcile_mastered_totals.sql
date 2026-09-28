-- Reconciles the running "mastered" total for accounts that predate the
-- `progress.mastered` column.
--
-- Migration 0006 added the column and then backfilled it:
--
--   UPDATE progress SET mastered=1 WHERE correct>=5;
--
-- That set the per-word flags without writing a `learning_events` row, and
-- `daily_stats.mastered` is only ever incremented by the trigger on
-- `learning_events`. So for any account that had already been active before
-- 0006 applied, the word shelf (which reads each row) and the mission total
-- (which sums `daily_stats`) disagree by however many words that statement
-- flipped, and no later run of the app can correct it: mastery is monotonic,
-- so those words never produce another mastery event.
--
-- This adds only the shortfall. A word is counted here when its row says
-- mastered but no mastery event was ever recorded for it, which is precisely
-- the set 0006 invented. Words mastered through normal play, and words carried
-- in by the legacy importer, both have a mastery event and are left alone.
--
-- The `rewards_initialized` gate is what keeps this from double counting.
-- `learning_events` is backfilled lazily, the first time an account is used,
-- and that backfill writes mastery events of its own. An account not opened
-- since before the events table existed therefore has no events *yet*, not no
-- events *ever*, and counting it here would let the backfill count the same
-- words again the moment the child next opened the app. Only an account whose
-- backfill has already happened can be measured this way.
--
-- The day is the migration's own local date. It does not matter which day it
-- lands on: `daily_stats` is only ever summed for the lifetime total, and the
-- day is not used to work out when a word was mastered.
--
-- This is a one-off repair. Migrations are applied once, in filename order, by
-- the loop in docs/DEPLOY.md, so it cannot be applied twice by accident.
INSERT INTO daily_stats(user_id,day,mastered)
SELECT
  p.user_id,
  date('now','localtime'),
  COUNT(*)
FROM progress p
JOIN users u ON u.id = p.user_id
WHERE p.mastered=1
  AND u.rewards_initialized=1
  AND NOT EXISTS (
    SELECT 1
    FROM learning_events e
    WHERE e.user_id=p.user_id
      AND e.word_id=p.word_id
      AND e.mastered=1
  )
GROUP BY p.user_id
ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered;
