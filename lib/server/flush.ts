import { CUMULATIVE_FLOOR } from "@/lib/challenge/mastery";
import { localDay } from "@/lib/challenge/rewards";
import { problemById } from "@/lib/challenge/bank";
import { database } from "./db";
import type { QuestionType } from "@/lib/challenge/config";

/**
 * A flush: everything the browser worked out in the last five minutes, written
 * in one go.
 *
 * The attempt rows go in **already answered**, and that is the whole trick. The
 * `attempts_one_pending_per_user` index is partial on `answered_at IS NULL`, so
 * there can only ever be one live question per child - which is exactly what made
 * a bulk flush impossible: a request that inserted twenty *pending* attempts
 * would have nineteen of them rejected. Answered rows are outside the index, so
 * twenty of them go in cleanly.
 *
 * `revealed` is bound rather than read off the attempt row, because an attempt
 * does not record it: whether a child asked for the answer or worked it out is
 * recorded on the award event, not on the question.
 *
 * The eligibility and mastery rules stay in SQL, in the same place they have
 * always been, and the trigger still does the awarding. The browser decides what
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
    CASE WHEN a.is_correct=1 AND NOT EXISTS(SELECT 1 FROM learning_events e
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
  if (!wanted.length) return { saved: 0, skipped };

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
          answer.evidence,
          answer.id,
          userId,
        ),
    ),
  );

  // The browser's counters, which it has been advancing since the last flush. This
  // is the client's authority over its own state; everything a credit depends on
  // was decided in the two steps above.
  if (state.progress.length) {
    await db.batch(
      state.progress.map(
        ([wordId, correct, run, recalls, mastered, seen, lastSeen, retryAt]) =>
          db
            .prepare(
              `UPDATE progress SET correct=?,run=?,recalls=?,mastered=?,seen=?,last_seen=?,retry_at=?
             WHERE user_id=? AND word_id=?`,
            )
            .bind(
              correct,
              run,
              recalls,
              mastered,
              seen,
              lastSeen,
              retryAt,
              userId,
              wordId,
            ),
      ),
    );
  }

  return { saved: wanted.length, skipped };
}
