import {
  advanceMastery,
  CUMULATIVE_FLOOR,
  hasMastered,
  type Evidence,
  type MasteryState,
} from "@/lib/challenge/mastery";
import { localDay } from "@/lib/challenge/rewards";
import { levelOf, problemById } from "@/lib/challenge/bank";
import { database } from "./db";
import type { QuestionType } from "@/lib/challenge/config";

/**
 * A flush: everything the browser worked out in the last minute, written
 * in one go.
 *
 * The attempt rows go in **already answered**, and that is the whole trick. The
 * `attempts_one_pending_per_user` index is partial on `answered_at IS NULL`, so
 * there can only ever be one live question per child - which is exactly what made
 * a bulk flush impossible: a request that inserted twenty *pending* attempts
 * would have nineteen of them rejected. Answered rows are outside the index, so
 * twenty of them go in cleanly.
 *
 * `revealed` and `mastered` are bound rather than read off the attempt row. An
 * attempt records neither: whether a child asked for the answer, and whether an
 * answer finished the word, live on the award event.
 *
 * Eligibility stays in SQL, in the same place it has always been, and the trigger
 * still does the awarding. The browser decides what
 * happened; the database decides what it is worth. That is the line worth holding,
 * because eligibility is the cap that stops a word being paid for six times, and
 * a client-side version of it would be a client-side way to farm credits.
 */
export type FlushedAnswer = {
  /** Client-generated, so a retried flush does not answer the same question twice. */
  id: string;
  wordId: string;
  type: QuestionType;
  answer: string;
  choices: string[];
  /** -1 for a reveal, otherwise the index chosen. */
  selected: number;
  elapsed: number;
  /** When the child was actually shown it, which is what the evidence uses. */
  shownAt: number;
  revealed: boolean;
  assisted: boolean;
  /** The evidence verdict the browser reached, recorded for reproducibility. */
  evidence: string;
};

export type FlushedState = {
  progress: [
    string,
    number,
    number,
    number,
    number,
    number,
    string | null,
    number | null,
  ][];
};

const ELIGIBLE_ANSWERS = 5;

/**
 * Whether a word counted, and whether this answer finished it.
 *
 * Both are decided from the database rather than taken from the browser, for the
 * reason above. `mastered` additionally requires the answer to have been right:
 * the original path has always paid the mastery bonus only on a correct answer,
 * so that a stale row which had already met the floor cannot be cashed in by a
 * miss.
 */
const LEARNING_EVENT = `
  INSERT OR IGNORE INTO learning_events
    (attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered,evidence)
  SELECT a.id,a.user_id,a.word_id,?,?,a.is_correct,?,
    CASE WHEN a.is_correct=1 AND p.mastered=0 AND p.correct<?
           AND (SELECT COUNT(*) FROM learning_events e
                 WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.eligible=1)<? THEN 1 ELSE 0 END,
    CASE WHEN ?=1 AND NOT EXISTS(SELECT 1 FROM learning_events e
                 WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.mastered=1) THEN 1 ELSE 0 END,
    ?
  FROM attempts a JOIN progress p ON p.user_id=a.user_id AND p.word_id=a.word_id
  WHERE a.id=? AND a.user_id=?`;

/** Put the words an answer touches in the progress table if they are not there. */
const ENSURE_PROGRESS = `
  INSERT INTO progress(user_id,word_id,correct,seen,retry_at)
  VALUES(?,?,0,0,NULL) ON CONFLICT(user_id,word_id) DO NOTHING`;

export type FlushResult = { saved: number; skipped: number };

export async function applyFlushed(
  userId: string,
  answers: FlushedAnswer[],
  state: FlushedState,
  allowedWordIds?: ReadonlySet<string>,
): Promise<FlushResult> {
  const db = database();

  // Drop anything this account may no longer be asked about, rather than letting
  // it fail one 409 at a time. A parent-added word is namespaced and always fine.
  const usable = answers.filter(
    (a) =>
      !allowedWordIds ||
      allowedWordIds.has(a.wordId) ||
      a.wordId.startsWith("own:"),
  );
  // A browser that retried a flush it never saw the answer to is normal, not
  // abuse, so a repeated id inside one flush is answered once.
  const seen = new Set<string>();
  const wanted: FlushedAnswer[] = [];
  let skipped = 0;
  for (const answer of usable) {
    if (seen.has(answer.id)) continue;
    seen.add(answer.id);
    // The answer comes from the bank, never from the browser. The question payload
    // deliberately does not carry it - a child must not be able to read it off
    // the question - and a tampered client must not be able to mark its own
    // answer right, which is the only thing the award turns on.
    const real = problemById.get(`${answer.type}:${answer.wordId}`);
    const resolved = real ? { ...answer, answer: real.answer } : answer;
    if (!resolved.choices.includes(resolved.answer)) {
      skipped++;
      continue;
    }
    wanted.push(resolved);
  }
  // A marking with no answers still carries state: "I know this" sets the
  // mastered flag without queuing an attempt, so stopping here would drop it
  // and the word would come back after a reload.
  if (!wanted.length && !state.progress.length) return { saved: 0, skipped };

  if (wanted.length) {
    // One round trip for the whole set, which is the point: these are pure inserts
    // and there is nothing to decide until they exist.
    await db.batch(
      wanted.flatMap((answer) => {
        const correct =
          answer.selected >= 0 &&
          answer.choices[answer.selected] === answer.answer;
        return [
          db
            .prepare(
              `INSERT OR IGNORE INTO attempts
                 (id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed)
               VALUES(?,?,?,?,?,?,?,'',?,?,?,?)`,
            )
            .bind(
              answer.id,
              userId,
              answer.wordId,
              JSON.stringify(answer.choices),
              answer.shownAt,
              answer.type,
              answer.answer,
              // `shownAt` is the clock the evidence is measured from, so a
              // question that sat in the queue is not read as a guess.
              answer.shownAt,
              answer.selected,
              correct ? 1 : 0,
              Math.round(answer.elapsed),
            ),
        ];
      }),
    );

    // The words an answer touches must exist before the events can join to them.
    await db.batch(
      wanted.map((answer) =>
        db.prepare(ENSURE_PROGRESS).bind(userId, answer.wordId),
      ),
    );

    // Which answers finished their word.
    //
    // Decided here, from the database's own progress and the same `advanceMastery`
    // the browser ran, rather than taken from the browser. The reason is specific:
    // the per-question path this replaced bound the app's verdict, which was safe
    // then because the app *was* the server. It is not safe now. A flush that
    // believed a client saying "this answer finished the word" would pay ten
    // credits a time for every word in the collection, and the only limit on it
    // would be the child choosing to stop.
    //
    // The evidence is the browser's, and has to be: it is a record of how long a
    // child spent on a question, which only the browser witnessed. It is recorded
    // rather than trusted for money, and it is the same string the server would
    // have derived from a stored attempt.
    const touched = [...new Set(wanted.map((answer) => answer.wordId))];
    const prior = new Map<string, MasteryState>();
    {
      // One read, for the words this flush touches. It is the only query the flush
      // does beyond its writes, and it happens on a save rather than on the path a
      // child is waiting on.
      const placeholders = touched.map(() => "?").join(",");
      const read = await db
        .prepare(
          `SELECT word_id,correct,run,recalls,mastered FROM progress
           WHERE user_id=? AND word_id IN (${placeholders})`,
        )
        .bind(userId, ...touched)
        .all<{
          word_id: string;
          correct: number;
          run: number;
          recalls: number;
          mastered: number;
        }>();
      for (const row of read.results)
        prior.set(row.word_id, {
          correct: row.correct,
          run: row.run,
          recalls: row.recalls,
          mastered: row.mastered === 1,
        });
    }
    // Answers in the order they were given, which is the order the child met them,
    // so a word answered twice in one sitting carries its evidence forward.
    const finished = new Map<string, boolean>();
    const states = new Map<string, MasteryState>(prior);
    for (const answer of wanted) {
      const before = states.get(answer.wordId) ?? {
        correct: 0,
        run: 0,
        recalls: 0,
        mastered: false,
      };
      const correct =
        answer.selected >= 0 && answer.choices[answer.selected] === answer.answer;
      const next = advanceMastery(
        before,
        (answer.evidence as Evidence) ?? "uncertain",
        levelOf.get(answer.wordId) ?? 1,
      );
      states.set(answer.wordId, next);
      finished.set(
        answer.id,
        correct && next.newlyMastered && !hasMastered(before),
      );
    }

    // The award chain: eligibility, mastery and the credits themselves, all decided
    // in SQL and applied by the trigger that has always done it.
    await db.batch(
      wanted.map((answer) =>
        db
          .prepare(LEARNING_EVENT)
          .bind(
            answer.shownAt,
            localDay(answer.shownAt),
            answer.revealed ? 1 : 0,
            CUMULATIVE_FLOOR,
            ELIGIBLE_ANSWERS,
            finished.get(answer.id) ? 1 : 0,
            answer.evidence,
            answer.id,
            userId,
          ),
      ),
    );
  }

  // The browser's counters, which it has been advancing since the last flush. This
  // is the client's authority over its own state; everything a credit depends on
  // was decided in the two steps above. It also runs for a state-only flush:
  // "I know this" sets the mastered flag without queuing an attempt, and that
  // flag still has to reach the database or the word comes back on reload.
  if (state.progress.length) {
    // The marked word may never have been answered, so its progress row may not
    // exist yet and an UPDATE alone would change nothing.
    await db.batch(
      [...new Set(state.progress.map(([wordId]) => wordId))].map((wordId) =>
        db.prepare(ENSURE_PROGRESS).bind(userId, wordId),
      ),
    );
    // A word the child marked known is mastered without an answer, so no
    // learning event fires and the trigger-maintained daily_stats never sees it.
    // The word is retired all the same, and both the panel's "words you know"
    // and the calendar read their totals from daily_stats, so the marking has to
    // move that counter too.
    //
    // This runs before the updates in the same batch and looks at the rows as
    // they stand: `mastered=0` makes a retried flush a no-op, and the event
    // check keeps a word an answer already mastered from being counted twice.
    // One batch is one transaction, so the count and the flag land together or
    // not at all.
    const marked = [
      ...new Set(
        state.progress
          .filter(([, correct, , , mastered]) =>
            hasMastered({ correct, mastered }),
          )
          .map(([wordId]) => wordId),
      ),
    ];
    const writes = state.progress.map(
      ([wordId, correct, run, recalls, mastered, seen, lastSeen, retryAt]) =>
        db
          .prepare(
            `UPDATE progress SET
               correct=MAX(correct,?),
               run=?,recalls=?,
               mastered=MAX(mastered,?),
               seen=?,
               last_seen=CASE
                 WHEN ? IS NULL THEN last_seen
                 WHEN last_seen IS NULL THEN ?
                 ELSE MAX(last_seen,?)
               END,
               retry_at=?
             WHERE user_id=? AND word_id=?`,
          )
          .bind(
            correct,
            run,
            recalls,
            mastered,
            seen,
            lastSeen,
            lastSeen,
            lastSeen,
            retryAt,
            userId,
            wordId,
          ),
    );
    if (marked.length) {
      writes.unshift(
        db
          .prepare(
            `INSERT INTO daily_stats(user_id,day,mastered)
             SELECT ?,?,COUNT(*)
             FROM progress p
             WHERE p.user_id=? AND p.word_id IN (${marked.map(() => "?").join(",")})
               AND p.mastered=0 AND p.correct<?
               AND NOT EXISTS(
                 SELECT 1 FROM learning_events e
                 WHERE e.user_id=p.user_id AND e.word_id=p.word_id AND e.mastered=1)
             HAVING COUNT(*)>0
             ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered`,
          )
          .bind(
            userId,
            localDay(Date.now()),
            userId,
            ...marked,
            CUMULATIVE_FLOOR,
          ),
      );
    }
    await db.batch(writes);
  }

  return { saved: wanted.length, skipped };
}
