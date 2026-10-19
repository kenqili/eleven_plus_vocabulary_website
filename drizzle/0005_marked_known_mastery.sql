-- "I know this" retires a word with no attempt, so no learning event fires and
-- the trigger-maintained daily_stats.mastered never learned about it. The word
-- is mastered in progress, but the panel and the calendar read daily_stats, so
-- they still counted only the words mastered by answering.
--
-- The forward path is lib/server/flush.ts, which moves the same counter when a
-- marking is saved. This is that correction for the markings made before it
-- existed. `last_seen` is the day the word was last shown, which for a marked
-- word is the day it was marked; an answer-mastered word is excluded by its
-- event, so nothing is counted twice.
INSERT INTO daily_stats(user_id,day,mastered)
SELECT p.user_id, COALESCE(p.last_seen, date('now')), COUNT(*)
FROM progress p
WHERE p.mastered = 1
  AND NOT EXISTS (
    SELECT 1 FROM learning_events e
    WHERE e.user_id = p.user_id AND e.word_id = p.word_id AND e.mastered = 1
  )
GROUP BY p.user_id, COALESCE(p.last_seen, date('now'))
ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered;
