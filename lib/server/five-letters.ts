import dictionary from "../../data/five-letters/dictionary.json" with { type: "json" };
import { words } from "@/lib/challenge/bank";
import { CUMULATIVE_FLOOR, hasMastered } from "@/lib/challenge/mastery";
import { localDay } from "@/lib/challenge/rewards";
import { placementFromBands } from "@/lib/challenge/placement";
import {
  availableHintKinds,
  gradeGuess,
  HINT_SCORE_PENALTY,
  hintFor,
  isAcceptedGuess,
  MAX_GUESSES,
  normalizeGuess,
  remainingHintKinds,
  usedHintKinds,
  type FiveLettersAnswer,
  type FiveLettersCard,
  type FiveLettersCountable,
  type FiveLettersGame,
  type FiveLettersGuess,
  type FiveLettersHintKind,
  type FiveLettersMark,
  type FiveLettersRound,
  type FiveLettersState,
  type FiveLettersStatus,
} from "@/lib/challenge/five-letters";
import { database } from "./db";
import { HttpError } from "./http";
import { isAllowedWord } from "./free-words";
import {
  EXCLUDED_WORD_IDS_SQL,
  excludedIdsFromRows,
} from "./parent-words";
import { accountBands } from "./placement";

/**
 * Five Letters persistence, and the one write a finished round makes.
 *
 * A round runs in the browser. The answer is sent with it, because a guess is
 * marked where the child is looking rather than where the server is, and the
 * account's knowledge is sent counted band by band, because the score has to
 * keep right while they play. Nothing is written until the round ends: the
 * browser reports the words it guessed, the server marks them itself and
 * records the credit, the mastery and the hints in one request.
 *
 * The server still decides what a guess is worth. The browser is asked which
 * words were guessed, never what they were worth.
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

const GAME_BY_ID_SQL = "SELECT * FROM word_games WHERE id=? AND user_id=?";
const GAME_PLAYING_SQL =
  "SELECT * FROM word_games WHERE user_id=? AND status='playing' ORDER BY created_at DESC LIMIT 1";
const GAME_LATEST_SQL =
  "SELECT * FROM word_games WHERE user_id=? ORDER BY created_at DESC LIMIT 1";
/** The words the child has played recently, so an answer does not repeat. */
const RECENT_GAMES_SQL =
  "SELECT word_id FROM word_games WHERE user_id=? ORDER BY created_at DESC LIMIT 20";
/** The child's progress, which decides what they have mastered. */
const PROGRESS_SQL =
  "SELECT word_id, correct, mastered FROM progress WHERE user_id = ?";

/**
 * Split a list into pieces small enough to bind.
 *
 * D1 allows a hundred bound parameters per query. The answer words are read
 * back in one request, so they are asked for in pieces rather than all at
 * once - the request is still one request, but no statement in it binds more
 * than D1 allows.
 */
const chunksOf = <T,>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const readGame = async (
  userId: string,
  id?: string,
): Promise<GameRow | null> => {
  const db = database();
  if (id)
    return db.prepare(GAME_BY_ID_SQL).bind(id, userId).first<GameRow>();
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

/**
 * The account's placement, and the words a guess can count.
 *
 * One round trip for all of it: the excluded words, the parent's own words,
 * the child's progress, the trailing answers and the hint penalty, with the
 * state of the answer words pulled out of the progress rows already read.
 */
async function placementFor(
  userId: string,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<{
  level: number;
  score: number;
  penalty: number;
  round: Omit<FiveLettersRound, "answer" | "hints" | "answers"> & {
    answers: FiveLettersCountable[];
  };
}> {
  const inputs = await accountBands(userId, ANSWERS);
  const { level, score } = placementFromBands(inputs.bands, inputs.trailing);
  const excluded = new Set(inputs.excluded);
  return {
    level,
    // Five Letters hints are permanent and account-level. Subtracting here as
    // well as in the game means every reader of the score sees one number.
    score: Math.max(0, score - inputs.penalty),
    penalty: inputs.penalty,
    round: {
      bands: inputs.bands,
      trailing: inputs.trailing,
      penalty: inputs.penalty,
      // Only the words this account may count. A free child is not told about
      // a word outside their collection, and the server checks again when the
      // round is written down.
      answers: inputs.words.filter(([id]) =>
        mayCount(id, allowedWordIds, excluded),
      ),
    },
  };
}

async function publicState(
  userId: string,
  row: GameRow | null,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const { score, penalty, round } = await placementFor(userId, allowedWordIds);
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
  // The round is sent only while it is being played. The answer is in it,
  // because the browser marks the guesses, and the hint texts are in it so
  // that a hint costs the child nothing but the points it costs.
  if (row.status !== "playing") return { ...base, game };
  const available = availableHintKinds(answerCard, row.word_id);
  const roundHints: Partial<Record<FiveLettersHintKind, string>> = {};
  for (const kind of available) {
    const relation = hintFor(answerCard, kind, row.word_id);
    if (relation) roundHints[kind] = relation;
  }
  return {
    ...base,
    game,
    round: { ...round, answer: row.word_id, hints: roundHints },
  };
}

const ENSURE_PROGRESS = `INSERT INTO progress(user_id,word_id,correct,seen,retry_at,last_seen)
  VALUES(?,?,0,0,NULL,?) ON CONFLICT(user_id,word_id) DO NOTHING`;



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
  const db = database();
  // One request for everything the start reads: the round in progress, the
  // last round, the words a parent has set aside, the child's progress and the
  // words they have played recently. These used to be five round trips, one
  // after another, before a single word was chosen.
  const out = await db.batch([
    db.prepare(GAME_PLAYING_SQL).bind(userId),
    db.prepare(GAME_LATEST_SQL).bind(userId),
    db.prepare(EXCLUDED_WORD_IDS_SQL).bind(userId),
    db.prepare(PROGRESS_SQL).bind(userId),
    db.prepare(RECENT_GAMES_SQL).bind(userId),
  ]);
  const rowsOf = <T,>(index: number): T[] =>
    index < 0
      ? []
      : ((out[index] as { results?: T[] } | undefined)?.results ?? []);
  const active = rowsOf<GameRow>(0)[0] ?? null;
  const latest = rowsOf<GameRow>(1)[0] ?? null;
  const excluded = excludedIdsFromRows(rowsOf<{ word_id: string }>(2));
  const progress = rowsOf<{
    word_id: string;
    correct: number;
    mastered: number;
  }>(3);
  const recentIds = new Set(
    rowsOf<{ word_id: string }>(4).map((row) => row.word_id),
  );

  if (active) {
    if (!(await discardIfNotAllowed(active, allowedWordIds)))
      return publicState(userId, active, allowedWordIds);
  }

  // A refresh after the last guess should still show the finished round; the
  // Next word button is the explicit request for a new one.
  if (!next) {
    if (latest && !(await discardIfNotAllowed(latest, allowedWordIds)))
      return publicState(userId, latest, allowedWordIds);
  }

  const eligible = ANSWERS.filter(
    (id) => isAllowedWord(id, allowedWordIds) && !excluded.has(id),
  );
  if (!eligible.length)
    throw new HttpError(
      403,
      "There are no Five Letters words available for this account.",
    );

  const byId = new Map(progress.map((row) => [row.word_id, row]));
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
  const created = await readGame(userId, id);
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

/**
 * Record a finished round.
 *
 * The browser reports the words it guessed, never the marks it drew and never
 * what they were worth: the server marks them itself, from the answer it has
 * been holding, and works the credit out from the database. So a browser that
 * says "crane" gets crane's marks, and a browser that says "crane" was worth
 * ten points gets nothing.
 *
 * The round is claimed before the credit is paid, so a retry - a child on a
 * slow line, a second tab - cannot pay twice. The claim is one request, the
 * credit is one request, and the answer comes back with the score the account
 * now has.
 */
export async function finishGame(
  userId: string,
  gameId: string,
  guessed: readonly string[],
  hintKinds: readonly FiveLettersHintKind[],
  status: "solved" | "revealed",
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<FiveLettersState> {
  const db = database();
  const out = await db.batch([
    db.prepare(GAME_BY_ID_SQL).bind(gameId, userId),
    db.prepare(EXCLUDED_WORD_IDS_SQL).bind(userId),
    ...chunksOf(ANSWERS, 90).map((chunk) =>
      db
        .prepare(
          `SELECT word_id,correct,mastered FROM progress
           WHERE user_id=? AND word_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(userId, ...chunk),
    ),
    ...chunksOf(ANSWERS, 90).map((chunk) =>
      db
        .prepare(
          `SELECT word_id FROM learning_events
           WHERE user_id=? AND mastered=1 AND word_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(userId, ...chunk),
    ),
  ]);
  const rowsOf = <T,>(index: number): T[] =>
    index < 0
      ? []
      : ((out[index] as { results?: T[] } | undefined)?.results ?? []);
  const row = rowsOf<GameRow>(0)[0] ?? null;
  if (!row) throw new HttpError(404, "That game is no longer available.");
  assertAnswerAllowed(row, allowedWordIds);
  if (row.status !== "playing")
    return {
      ...(await publicState(userId, row, allowedWordIds)),
      duplicate: true,
    };

  const excluded = excludedIdsFromRows(rowsOf<{ word_id: string }>(1));
  const progressRows = rowsOf<{
    word_id: string;
    correct: number;
    mastered: number;
  }>(2);
  const progress = new Map(progressRows.map((entry) => [entry.word_id, entry]));
  const eventMastered = new Set(
    rowsOf<{ word_id: string }>(2 + chunksOf(ANSWERS, 90).length).map(
      (entry) => entry.word_id,
    ),
  );

  // The words the browser reported, in the order it reported them, kept only
  // when they are real guesses and not repeats.
  const words: string[] = [];
  for (const reported of guessed) {
    const word = normalizeGuess(reported);
    if (!word || !isAcceptedGuess(word)) continue;
    if (words.includes(word)) continue;
    words.push(word);
    if (words.length >= MAX_GUESSES) break;
  }

  const counted = words.filter((word) =>
    mayCount(word, allowedWordIds, excluded),
  );
  const solved = status === "solved" && words.includes(row.word_id);
  const answerCard = cardFor(row.word_id);
  const availableHints = availableHintKinds(answerCard, row.word_id);
  const hints = [
    ...new Set(hintKinds.filter((kind) => availableHints.includes(kind))),
  ];

  // What each guess was worth, worked out here rather than believed.
  const stored: StoredGuess[] = words.map((word) => {
    const before = progress.get(word);
    const prior = before?.correct ?? 0;
    const wasMastered =
      hasMastered({ mastered: before?.mastered, correct: prior }) ||
      eventMastered.has(word);
    const doesCount = counted.includes(word);
    return {
      word,
      marks: gradeGuess(row.word_id, word),
      counted: doesCount,
      correct: doesCount ? Math.min(CUMULATIVE_FLOOR, prior + 1) : 0,
      mastered: doesCount && !wasMastered && prior >= CUMULATIVE_FLOOR - 1,
    };
  });

  const before = progress.get(row.word_id);
  const answerWasMastered =
    hasMastered({ mastered: before?.mastered, correct: before?.correct ?? 0 }) ||
    eventMastered.has(row.word_id);
  const answerMastery = solved
    ? answerWasMastered
      ? { newlyMastered: false, alreadyMastered: true }
      : { newlyMastered: true, alreadyMastered: false }
    : { newlyMastered: false, alreadyMastered: false };

  // The claim. One row, one request, and the guard that makes a retry free.
  const now = Date.now();
  const claim = await db
    .prepare(
      `UPDATE word_games
       SET guesses=?,hints=?,status=?,answer_newly_mastered=?,answer_already_mastered=?,updated_at=?
       WHERE id=? AND user_id=? AND status='playing'`,
    )
    .bind(
      JSON.stringify(stored),
      hints.join(","),
      solved ? "solved" : "revealed",
      answerMastery.newlyMastered ? 1 : 0,
      answerMastery.alreadyMastered ? 1 : 0,
      now,
      row.id,
      userId,
    )
    .run();
  if (!((claim.meta as { changes?: number } | undefined)?.changes ?? 0)) {
    // Another tab got there first. Returning its state is the retry-safe
    // answer; a second finish must not pay twice.
    return {
      ...(await publicState(
        userId,
        await readGame(userId, gameId),
        allowedWordIds,
      )),
      duplicate: true,
    };
  }

  // The credit, in one request: the progress rows for the words that counted,
  // the daily counter, the answer's mastery and the penalty for the hints.
  // The answer is only mastered when the round was solved. A round that was
  // given up masters nothing, and the answer it shows is the child's to
  // remember, not a word the account has learnt.
  const day = localDay(now);
  const statements = [];
  if (solved) {
    statements.push(
      db.prepare(ENSURE_PROGRESS).bind(userId, row.word_id, day),
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
        .bind(userId, day, userId, row.word_id, CUMULATIVE_FLOOR),
      db
        .prepare(
          "UPDATE progress SET mastered=1 WHERE user_id=? AND word_id=?",
        )
        .bind(userId, row.word_id),
    );
  }
  for (const word of counted) {
    statements.push(db.prepare(ENSURE_PROGRESS).bind(userId, word, day));
  }
  if (counted.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO daily_stats(user_id,day,mastered)
           SELECT ?,?,COUNT(*)
           FROM progress p
           WHERE p.user_id=? AND p.word_id IN (${counted.map(() => "?").join(",")})
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
          ...counted,
          CUMULATIVE_FLOOR - 1,
          CUMULATIVE_FLOOR,
        ),
    );
  }
  for (const word of counted) {
    statements.push(
      db
        .prepare(
          `UPDATE progress
           SET correct=MIN(?,correct+1),
               mastered=CASE WHEN correct>=? THEN 1 ELSE mastered END,
               last_seen=?
           WHERE user_id=? AND word_id=?`,
        )
        .bind(CUMULATIVE_FLOOR, CUMULATIVE_FLOOR - 1, day, userId, word),
    );
  }
  if (hints.length) {
    statements.push(
      db
        .prepare(
          "UPDATE users SET score_penalty=score_penalty+? WHERE id=?",
        )
        .bind(HINT_SCORE_PENALTY * hints.length, userId),
    );
  }
  // An empty batch is still a request. A round that was given up, with no
  // counting guess and no hint, has nothing to write, and saying so costs
  // nothing.
  if (statements.length) await db.batch(statements);
  return publicState(userId, await readGame(userId, gameId), allowedWordIds);
}


/** Exposed for the integration test and for a cheap diagnostic. */
export const fiveLettersAnswers = ANSWERS;
