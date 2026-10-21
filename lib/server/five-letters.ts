import dictionary from "../../data/five-letters/dictionary.json" with { type: "json" };
import { words } from "@/lib/challenge/bank";
import { CUMULATIVE_FLOOR, hasMastered } from "@/lib/challenge/mastery";
import { localDay } from "@/lib/challenge/rewards";
import {
  availableHintKinds,
  gradeGuess,
  HINT_SCORE_PENALTY,
  hintFor,
  MAX_GUESSES,
  remainingHintKinds,
  usedHintKinds,
  type FiveLettersAnswer,
  type FiveLettersCard,
  type FiveLettersGame,
  type FiveLettersGuess,
  type FiveLettersHintKind,
  type FiveLettersMark,
  type FiveLettersState,
  type FiveLettersStatus,
} from "@/lib/challenge/five-letters";
import { database } from "./db";
import { HttpError } from "./http";
import { isAllowedWord } from "./free-words";
import { excludedWordIds } from "./parent-words";
import { accountScore } from "./placement";

/**
 * Five Letters persistence and the two writes a game may make to progress.
 *
 * The answer is a bank id and is never sent while the round is playing. Guesses
 * are stored with their marks and with the count this guess produced, so a
 * reload shows the same card rather than re-deriving history from a progress
 * total that may have moved since.
 */

const DICTIONARY = dictionary as Record<string, FiveLettersCard>;

const ANSWERS = words
  .filter((word) => word.word.length === 5)
  .map((word) => word.id);
const ANSWER_SET = new Set(ANSWERS);
for (const answer of ANSWERS)
  if (!DICTIONARY[answer])
    throw new Error(`Five Letters has no card for its answer "${answer}".`);

const FALLBACK_CARD: FiveLettersCard = {
  definition:
    "This is a valid five-letter word, but it is not one of the vocabulary words.",
  example: "",
  synonyms: [],
  antonyms: [],
  source: "Game list",
};

const cardFor = (word: string): FiveLettersCard =>
  DICTIONARY[word] ?? FALLBACK_CARD;

type StoredGuess = {
  word: string;
  marks: FiveLettersMark[];
  counted?: boolean;
  correct?: number;
  mastered?: boolean;
};

type GameRow = {
  id: string;
  user_id: string;
  word_id: string;
  guesses: string;
  hints: string;
  status: FiveLettersStatus;
  day: string;
  created_at: number;
  updated_at: number;
  answer_newly_mastered: number;
  answer_already_mastered: number;
};

type ProgressRow = {
  correct: number;
  mastered: number;
  event_mastered?: number;
};

const readGame = async (
  userId: string,
  id?: string,
): Promise<GameRow | null> => {
  const db = database();
  if (id)
    return db
      .prepare("SELECT * FROM word_games WHERE id=? AND user_id=?")
      .bind(id, userId)
      .first<GameRow>();
  return db
    .prepare(
      "SELECT * FROM word_games WHERE user_id=? AND status='playing' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<GameRow>();
};

const readLatestGame = async (userId: string): Promise<GameRow | null> =>
  database()
    .prepare(
      "SELECT * FROM word_games WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<GameRow>();

function parsedGuesses(row: GameRow): StoredGuess[] {
  try {
    const value = JSON.parse(row.guesses);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is StoredGuess =>
        entry &&
        typeof entry.word === "string" &&
        Array.isArray(entry.marks) &&
        entry.marks.length === 5,
    );
  } catch {
    return [];
  }
}

const hintsOf = (row: GameRow) => usedHintKinds(row.hints);

async function publicState(
  userId: string,
  row: GameRow | null,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  // One round trip for the score and the penalty, instead of one for the
  // placement and another for the penalty. The score only changes when the
  // child's knowledge changes, and the hint penalty only when a hint is taken,
  // so this is the same read on every request.
  const { score, penalty } = await accountScore(userId);
  const base = {
    score,
    scorePenalty: penalty,
    freeTier: Boolean(allowedWordIds),
    freeWordCount: allowedWordIds?.size ?? 0,
  };
  if (!row) return { ...base, game: null };

  const answerCard = cardFor(row.word_id);
  const guesses: FiveLettersGuess[] = parsedGuesses(row).map((guess) => ({
    word: guess.word,
    marks: guess.marks,
    card: cardFor(guess.word),
    counted: Boolean(guess.counted),
    correct: Number(guess.correct) || 0,
    mastered: Boolean(guess.mastered),
  }));
  const hints = hintsOf(row);
  const hintText: Partial<Record<FiveLettersHintKind, string>> = {};
  for (const kind of hints) {
    const relation = hintFor(answerCard, kind, row.word_id);
    if (relation) hintText[kind] = relation;
  }
  const answer: FiveLettersAnswer | undefined =
    row.status === "playing"
      ? undefined
      : {
          word: row.word_id,
          card: answerCard,
          newlyMastered: row.answer_newly_mastered === 1,
          alreadyMastered: row.answer_already_mastered === 1,
        };
  const game: FiveLettersGame = {
    id: row.id,
    guesses,
    hints,
    hintText,
    remainingGuesses: Math.max(0, MAX_GUESSES - guesses.length),
    remainingHints: remainingHintKinds(answerCard, row.word_id, row.hints),
    status: row.status,
    ...(answer ? { answer } : {}),
  };
  return { ...base, game };
}

/** The one progress read that tells the UI what this guess is about to do. */
async function progressFor(
  userId: string,
  wordId: string,
): Promise<ProgressRow | null> {
  return database()
    .prepare(
      `SELECT p.correct,p.mastered,
        EXISTS(SELECT 1 FROM learning_events e
          WHERE e.user_id=p.user_id AND e.word_id=p.word_id AND e.mastered=1) AS event_mastered
       FROM progress p WHERE p.user_id=? AND p.word_id=?`,
    )
    .bind(userId, wordId)
    .first<ProgressRow>();
}

const ENSURE_PROGRESS = `INSERT INTO progress(user_id,word_id,correct,seen,retry_at,last_seen)
  VALUES(?,?,0,0,NULL,?) ON CONFLICT(user_id,word_id) DO NOTHING`;

/**
 * A solve retires the answer, with no attempt, credit, streak or study time.
 *
 * The daily counter is moved only when the pre-update row was not already
 * mastered, and the learning-event check is the same guard the flush uses. A
 * word mastered by an answer or by "I know this" is therefore never counted
 * twice, and a retried solve is a no-op.
 */
export async function markWordMastered(
  userId: string,
  wordId: string,
  day = localDay(Date.now()),
): Promise<{ newlyMastered: boolean; alreadyMastered: boolean }> {
  const before = await progressFor(userId, wordId);
  if (hasMastered(before ?? {}) || before?.event_mastered) {
    return { newlyMastered: false, alreadyMastered: true };
  }
  const db = database();
  await db.batch([
    db.prepare(ENSURE_PROGRESS).bind(userId, wordId, day),
    db
      .prepare(
        `INSERT INTO daily_stats(user_id,day,mastered)
         SELECT ?,?,1
         WHERE EXISTS(
           SELECT 1 FROM progress p
           WHERE p.user_id=? AND p.word_id=? AND p.mastered=0 AND p.correct<?
             AND NOT EXISTS(
               SELECT 1 FROM learning_events e
               WHERE e.user_id=p.user_id AND e.word_id=p.word_id AND e.mastered=1)
         )
         ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered`,
      )
      .bind(userId, day, userId, wordId, CUMULATIVE_FLOOR),
    db
      .prepare("UPDATE progress SET mastered=1 WHERE user_id=? AND word_id=?")
      .bind(userId, wordId),
  ]);
  return { newlyMastered: true, alreadyMastered: false };
}

/**
 * One guessed vocabulary word counts one correctness, capped at the cumulative
 * floor. This is the same counter practice advances; the game only adds one.
 */
export async function countGuessCorrectness(
  userId: string,
  wordId: string,
  day = localDay(Date.now()),
): Promise<{ correct: number; mastered: boolean }> {
  const before = await progressFor(userId, wordId);
  const prior = before?.correct ?? 0;
  const wasMastered =
    hasMastered(before ?? {}) || Boolean(before?.event_mastered);
  const db = database();
  await db.batch([
    db.prepare(ENSURE_PROGRESS).bind(userId, wordId, day),
    db
      .prepare(
        `INSERT INTO daily_stats(user_id,day,mastered)
         SELECT ?,?,1
         WHERE EXISTS(
           SELECT 1 FROM progress p
           WHERE p.user_id=? AND p.word_id=? AND p.mastered=0
             AND p.correct>=? AND p.correct<?
             AND NOT EXISTS(
               SELECT 1 FROM learning_events e
               WHERE e.user_id=p.user_id AND e.word_id=p.word_id AND e.mastered=1)
         )
         ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+excluded.mastered`,
      )
      .bind(
        userId,
        day,
        userId,
        wordId,
        CUMULATIVE_FLOOR - 1,
        CUMULATIVE_FLOOR,
      ),
    db
      .prepare(
        `UPDATE progress
         SET correct=MIN(?,correct+1),
             mastered=CASE WHEN correct>=? THEN 1 ELSE mastered END,
             last_seen=?
         WHERE user_id=? AND word_id=?`,
      )
      .bind(CUMULATIVE_FLOOR, CUMULATIVE_FLOOR - 1, day, userId, wordId),
  ]);
  return {
    correct: Math.min(CUMULATIVE_FLOOR, prior + 1),
    mastered: !wasMastered && prior >= CUMULATIVE_FLOOR - 1,
  };
}

function mayCount(
  wordId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
  excluded: ReadonlySet<string>,
): boolean {
  return (
    ANSWER_SET.has(wordId) &&
    isAllowedWord(wordId, allowedWordIds) &&
    !excluded.has(wordId)
  );
}

/**
 * A free account's entitlement can lapse between two requests, and an answer
 * chosen during a trial may sit outside the free collection. That round is no
 * longer playable: allowing the guess would master a word the account may not
 * keep, and showing the answer would break the free pool.
 */
function assertAnswerAllowed(
  row: GameRow | null,
  allowedWordIds: ReadonlySet<string> | undefined,
) {
  if (row && allowedWordIds && !isAllowedWord(row.word_id, allowedWordIds))
    throw new HttpError(
      409,
      "This round is no longer available. Start a new one.",
    );
}

async function discardIfNotAllowed(
  row: GameRow | null,
  allowedWordIds: ReadonlySet<string> | undefined,
) {
  if (!row || !allowedWordIds || isAllowedWord(row.word_id, allowedWordIds))
    return false;
  await database()
    .prepare("DELETE FROM word_games WHERE id=? AND user_id=?")
    .bind(row.id, row.user_id)
    .run();
  return true;
}

/** Resume the one active game, or choose a fresh answer from the live pool. */
export async function startOrResume(
  userId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
  next = false,
): Promise<FiveLettersState> {
  const active = await readGame(userId);
  if (active) {
    if (!(await discardIfNotAllowed(active, allowedWordIds)))
      return publicState(userId, active, allowedWordIds);
  }

  // A refresh after the last guess should still show the finished round; the
  // Next word button is the explicit request for a new one.
  if (!next) {
    const latest = await readLatestGame(userId);
    if (latest && !(await discardIfNotAllowed(latest, allowedWordIds)))
      return publicState(userId, latest, allowedWordIds);
  }

  const excluded = await excludedWordIds(userId);
  const eligible = ANSWERS.filter(
    (id) => isAllowedWord(id, allowedWordIds) && !excluded.has(id),
  );
  if (!eligible.length)
    throw new HttpError(
      403,
      "There are no Five Letters words available for this account.",
    );

  const db = database();
  const [recent, progress] = await Promise.all([
    db
      .prepare(
        "SELECT word_id FROM word_games WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .bind(userId)
      .all<{ word_id: string }>(),
    db
      .prepare("SELECT word_id,correct,mastered FROM progress WHERE user_id=?")
      .bind(userId)
      .all<{ word_id: string; correct: number; mastered: number }>(),
  ]);
  const recentIds = new Set(recent.results.map((row) => row.word_id));
  const byId = new Map(progress.results.map((row) => [row.word_id, row]));
  const unmastered = eligible.filter((id) => !hasMastered(byId.get(id) ?? {}));
  const met =
    // The "met" group is the unmastered words the child has actually seen.
    unmastered.filter((id) => byId.has(id));
  const fresh = eligible.filter((id) => !hasMastered(byId.get(id) ?? {}));
  const mastered = eligible.filter((id) => hasMastered(byId.get(id) ?? {}));
  let pool = [met, fresh, mastered].find((group) => group.length) ?? eligible;
  const withoutRecent = pool.filter((id) => !recentIds.has(id));
  if (withoutRecent.length) pool = withoutRecent;

  const wordId = pool[Math.floor(Math.random() * pool.length)];
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT OR IGNORE INTO word_games
        (id,user_id,word_id,guesses,hints,status,day,created_at,updated_at,answer_newly_mastered,answer_already_mastered)
       VALUES(?,?,?,'[]','','playing',?,?,?,0,0)`,
    )
    .bind(id, userId, wordId, localDay(now), now, now)
    .run();
  const created = await readGame(userId);
  if (!created)
    throw new HttpError(409, "Another game started. Please try again.");
  return publicState(userId, created, allowedWordIds);
}

export async function stateFor(
  userId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const row = (await readGame(userId)) ?? (await readLatestGame(userId));
  if (await discardIfNotAllowed(row, allowedWordIds))
    return publicState(userId, null, allowedWordIds);
  return publicState(userId, row, allowedWordIds);
}

export async function guessGame(
  userId: string,
  gameId: string,
  word: string,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const row = await readGame(userId, gameId);
  if (!row) throw new HttpError(404, "That game is no longer available.");
  assertAnswerAllowed(row, allowedWordIds);
  if (
    row.status !== "playing" ||
    parsedGuesses(row).some((g) => g.word === word)
  )
    return {
      ...(await publicState(userId, row, allowedWordIds)),
      duplicate: true,
    };

  const excluded = await excludedWordIds(userId);
  const counted = mayCount(word, allowedWordIds, excluded);
  const guesses = parsedGuesses(row);
  const marks = gradeGuess(row.word_id, word);
  const solved = word === row.word_id;
  const status: FiveLettersStatus = solved
    ? "solved"
    : guesses.length + 1 >= MAX_GUESSES
      ? "revealed"
      : "playing";
  const placeholder: StoredGuess = {
    word,
    marks,
    counted,
    correct: 0,
    mastered: false,
  };
  const nextGuesses = [...guesses, placeholder];
  const now = Date.now();
  const db = database();
  const update = await db
    .prepare(
      `UPDATE word_games
       SET guesses=?,status=?,answer_newly_mastered=0,answer_already_mastered=0,updated_at=?
       WHERE id=? AND user_id=? AND status='playing' AND guesses=?`,
    )
    .bind(JSON.stringify(nextGuesses), status, now, row.id, userId, row.guesses)
    .run();
  const changed =
    (update.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (!changed) {
    // Another tab got there first. Returning its state is the retry-safe
    // answer; a second click must not append a second row or pay twice.
    return {
      ...(await publicState(
        userId,
        await readGame(userId, gameId),
        allowedWordIds,
      )),
      duplicate: true,
    };
  }

  let answerMastery = { newlyMastered: false, alreadyMastered: false };
  if (solved) {
    answerMastery = await markWordMastered(userId, row.word_id, localDay(now));
  }
  let count = { correct: 0, mastered: false };
  if (counted) {
    count = await countGuessCorrectness(userId, word, localDay(now));
  }
  const finalGuess: StoredGuess = {
    ...placeholder,
    correct: count.correct,
    mastered: count.mastered,
  };
  const persisted = [...guesses, finalGuess];
  await db
    .prepare(
      `UPDATE word_games
       SET guesses=?,answer_newly_mastered=?,answer_already_mastered=?
       WHERE id=? AND user_id=?`,
    )
    .bind(
      JSON.stringify(persisted),
      answerMastery.newlyMastered ? 1 : 0,
      answerMastery.alreadyMastered ? 1 : 0,
      row.id,
      userId,
    )
    .run();
  return publicState(userId, await readGame(userId, gameId), allowedWordIds);
}

export async function hintGame(
  userId: string,
  gameId: string,
  kind: FiveLettersHintKind,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const row = await readGame(userId, gameId);
  if (!row) throw new HttpError(404, "That game is no longer available.");
  assertAnswerAllowed(row, allowedWordIds);
  if (row.status !== "playing" || hintsOf(row).includes(kind))
    return {
      ...(await publicState(userId, row, allowedWordIds)),
      duplicate: true,
    };
  const card = cardFor(row.word_id);
  if (!availableHintKinds(card, row.word_id).includes(kind))
    throw new HttpError(409, "That hint is not available for this word.");
  const now = Date.now();
  const db = database();
  await db.batch([
    db
      .prepare(
        `UPDATE word_games
         SET hints=CASE WHEN hints='' THEN ? ELSE hints || ',' || ? END,
             updated_at=?
         WHERE id=? AND user_id=? AND status='playing' AND instr(hints,?)=0`,
      )
      .bind(kind, kind, now, row.id, userId, kind),
    // `changes()` is the row count of the statement immediately before this
    // one. The penalty therefore moves only when the hint kind was actually
    // appended; a retry, or a second identical hint, is free.
    db
      .prepare(
        "UPDATE users SET score_penalty=score_penalty+? WHERE id=? AND changes()>0",
      )
      .bind(HINT_SCORE_PENALTY, userId),
  ]);
  const next = await readGame(userId, gameId);
  if (!next || !hintsOf(next).includes(kind))
    return {
      ...(await publicState(userId, next, allowedWordIds)),
      duplicate: true,
    };
  return publicState(userId, next, allowedWordIds);
}

export async function revealGame(
  userId: string,
  gameId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const row = await readGame(userId, gameId);
  if (!row) throw new HttpError(404, "That game is no longer available.");
  assertAnswerAllowed(row, allowedWordIds);
  if (row.status !== "playing")
    return {
      ...(await publicState(userId, row, allowedWordIds)),
      duplicate: true,
    };
  const now = Date.now();
  await database()
    .prepare(
      `UPDATE word_games
       SET status='revealed',answer_newly_mastered=0,answer_already_mastered=0,updated_at=?
       WHERE id=? AND user_id=? AND status='playing'`,
    )
    .bind(now, row.id, userId)
    .run();
  return publicState(userId, await readGame(userId, gameId), allowedWordIds);
}

/** Exposed for the integration test and for a cheap diagnostic. */
export const fiveLettersAnswers = ANSWERS;
