import { wordById, words } from "@/lib/challenge/bank";
import { CUMULATIVE_FLOOR } from "@/lib/challenge/mastery";
import { localDay } from "@/lib/challenge/rewards";
import {
  buildQuestions,
  gradeSelection,
  QUESTIONS_PER_MATCH,
  relationAnswers,
  RELATION_KINDS,
  type RelationFinish,
  type RelationKind,
  type RelationMatch,
  type RelationQuestion,
  type RelationResult,
} from "@/lib/challenge/relations";
import { freeWordIds } from "./free-words";
import { database } from "./db";
import { HttpError } from "./http";

/**
 * The relation challenge's one write, and its score history.
 *
 * A match runs in the browser: the questions are built on the server and sent
 * with the page, the child's picks are marked where the child is looking, and
 * the whole match is written down once at the end. The server does not take the
 * browser's word for what was right - it recomputes the answer set from the bank
 * for every word reported - so a tampered client can claim a score, but it
 * cannot claim a correctness.
 *
 * The match id comes from the browser so a retry is the same row. The insert is
 * the claim: if the id is already there, the match has been paid for once and
 * the award is skipped. That is the same shape as Five Letters, and it is the
 * only thing standing between a flaky connection and a word counted twice.
 */

export type RelationState = {
  kind: RelationKind;
  questions: RelationQuestion[];
  history: RelationMatch[];
};

const HISTORY_SQL = `SELECT id,kind,score,questions,seconds,created_at AS createdAt
  FROM game_matches WHERE user_id=? AND kind=? ORDER BY created_at DESC LIMIT 10`;

const ENSURE_PROGRESS = `INSERT INTO progress(user_id,word_id,correct,seen,retry_at,last_seen)
  VALUES(?,?,0,0,NULL,?) ON CONFLICT(user_id,word_id) DO NOTHING`;

export function relationKind(value: unknown): RelationKind {
  if (
    typeof value === "string" &&
    (RELATION_KINDS as readonly string[]).includes(value)
  )
    return value as RelationKind;
  throw new HttpError(400, "Choose a synonym or an antonym challenge.");
}

/** The questions a signed-out visitor plays. The free collection, no history. */
export function guestQuestions(kind: RelationKind): RelationQuestion[] {
  const allowed = freeWordIds();
  const targets = words.filter(
    (word) =>
      allowed.has(word.id) && relationAnswers(word, kind).length > 0,
  );
  return buildQuestions({ kind, targets, vocabulary: words });
}

async function historyFor(
  userId: string,
  kind: RelationKind,
): Promise<RelationMatch[]> {
  const result = await database()
    .prepare(HISTORY_SQL)
    .bind(userId, kind)
    .all<RelationMatch>();
  return result.results ?? [];
}

export async function startRelationGame(
  userId: string,
  kind: RelationKind,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<RelationState> {
  const targets = words.filter(
    (word) =>
      (!allowedWordIds || allowedWordIds.has(word.id)) &&
      relationAnswers(word, kind).length > 0,
  );
  if (!targets.length)
    throw new HttpError(
      402,
      "Your free collection is disabled. Subscribe to continue playing.",
    );
  const questions = buildQuestions({ kind, targets, vocabulary: words });
  const history = await historyFor(userId, kind);
  if (!questions.length)
    throw new HttpError(402, "There are no words to play with yet.");
  return { kind, questions, history };
}

/**
 * Record a finished match.
 *
 * `submitted` is the browser's report of what it picked, not what it scored.
 * Every word is looked up again, every selection is graded against the bank,
 * and only the words that were answered exactly right get a correctness. A
 * word repeated inside one match counts once, so a client cannot send the same
 * easy word ten times and finish it in a sitting.
 */
export async function finishRelationMatch(
  userId: string,
  kind: RelationKind,
  matchId: string,
  submitted: readonly unknown[],
  seconds: unknown,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<RelationFinish> {
  const db = database();
  const now = Date.now();
  const day = localDay(now);

  const graded: RelationResult[] = [];
  const seen = new Set<string>();
  for (const entry of submitted.slice(0, QUESTIONS_PER_MATCH)) {
    if (!entry || typeof entry !== "object") continue;
    const wordId = (entry as { wordId?: unknown }).wordId;
    if (typeof wordId !== "string" || seen.has(wordId)) continue;
    seen.add(wordId);
    const word = wordById(wordId);
    if (!word) continue;
    if (allowedWordIds && !allowedWordIds.has(word.id)) continue;
    const answers = relationAnswers(word, kind);
    if (!answers.length) continue;
    const raw = (entry as { selected?: unknown }).selected;
    const selected = Array.isArray(raw)
      ? raw
          .filter((value): value is string => typeof value === "string")
          .slice(0, 8)
      : [];
    graded.push({
      wordId: word.id,
      word: word.word,
      correct: gradeSelection(selected, answers),
    });
  }

  const score = graded.filter((result) => result.correct).length;
  const cleanSeconds = Math.max(
    0,
    Math.min(3600, Math.round(Number(seconds) || 0)),
  );

  // The claim. A retry - a slow line, a second tab - finds the row and is
  // answered from it, rather than being paid for a second time.
  const claim = await db
    .prepare(
      `INSERT INTO game_matches(id,user_id,kind,score,questions,seconds,created_at)
       VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(matchId, userId, kind, score, graded.length, cleanSeconds, now)
    .run();
  const inserted =
    ((claim.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
  if (!inserted) {
    const existing = await db
      .prepare(
        `SELECT id,kind,score,questions,seconds,created_at AS createdAt
         FROM game_matches WHERE id=? AND user_id=?`,
      )
      .bind(matchId, userId)
      .first<RelationMatch>();
    if (!existing)
      throw new HttpError(409, "That match id belongs to another account.");
    return {
      score: existing.score,
      questions: existing.questions,
      seconds: existing.seconds,
      awarded: 0,
      results: [],
      history: await historyFor(userId, kind),
      duplicate: true,
    };
  }

  const credited = graded
    .filter((result) => result.correct)
    .map((result) => result.wordId);
  let awarded = credited.length;
  if (credited.length) {
    const placeholders = credited.map(() => "?").join(",");
    // A word already at the floor gains nothing by being right again. The
    // count the child is shown has to be what actually changed, not how many
    // questions were answered well.
    const before = await db
      .prepare(
        `SELECT word_id,correct FROM progress
         WHERE user_id=? AND word_id IN (${placeholders})`,
      )
      .bind(userId, ...credited)
      .all<{ word_id: string; correct: number }>();
    const counts = new Map(
      (before.results ?? []).map((row) => [row.word_id, row.correct]),
    );
    awarded = credited.filter(
      (wordId) => (counts.get(wordId) ?? 0) < CUMULATIVE_FLOOR,
    ).length;
    const statements = [
      ...credited.map((wordId) =>
        db.prepare(ENSURE_PROGRESS).bind(userId, wordId, day),
      ),
      // Counted before the increment, so a word crossing the floor is the one
      // that shows up as newly mastered - the same order Five Letters uses.
      db
        .prepare(
          `INSERT INTO daily_stats(user_id,day,mastered)
           SELECT ?,?,COUNT(*)
           FROM progress p
           WHERE p.user_id=? AND p.word_id IN (${placeholders})
             AND p.mastered=0 AND p.correct>=? AND p.correct<?
             AND NOT EXISTS(
               SELECT 1 FROM learning_events e
               WHERE e.user_id=p.user_id AND e.word_id=p.word_id AND e.mastered=1)
           ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered`,
        )
        .bind(
          userId,
          day,
          userId,
          ...credited,
          CUMULATIVE_FLOOR - 1,
          CUMULATIVE_FLOOR,
        ),
      ...credited.map((wordId) =>
        db
          .prepare(
            `UPDATE progress
             SET correct=MIN(?,correct+1),
                 mastered=CASE WHEN correct>=? THEN 1 ELSE mastered END,
                 last_seen=?
             WHERE user_id=? AND word_id=?`,
          )
          .bind(
            CUMULATIVE_FLOOR,
            CUMULATIVE_FLOOR - 1,
            day,
            userId,
            wordId,
          ),
      ),
    ];
    await db.batch(statements);
  }

  return {
    score,
    questions: graded.length,
    seconds: cleanSeconds,
    awarded,
    results: graded,
    history: await historyFor(userId, kind),
  };
}
