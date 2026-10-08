import {
  CUMULATIVE_FLOOR,
  advanceMastery,
  answerWindow,
  classify,
  hasMastered,
  initialMastery,
  masteryProgress,
  type Evidence,
} from "@/lib/challenge/mastery";
import {
  awardFor,
  buildSummary,
  initializeRewards,
  summaryReads,
} from "./rewards";
import { storyMeaning, wordClue } from "@/lib/challenge/story-meanings";
import { localDay } from "@/lib/challenge/rewards";
import { chooseWord, reviewDueAt } from "@/lib/challenge/ordering";
import {
  allocationFor,
  currentLevel,
  levelFractions,
  levelScore,
  narrowToBand,
  stretchFraction,
  type Placement,
  type TrailingAnswer,
} from "@/lib/challenge/placement";
import { trailingAnswers } from "./placement";
import {
  choicesForProblem,
  levelOf,
  words,
  problems,
} from "@/lib/challenge/bank";
import { isAllowedWord } from "./free-words";
import { problemsForAddedWords } from "@/lib/challenge/problems";
import {
  customWordsFor,
  excludedWordIds,
  practiceWordsFor,
} from "./parent-words";
import { difficultyForAddedWord } from "@/lib/challenge/added-words";
import { shuffle, type Word } from "@/lib/challenge/words";
import { type QuestionType } from "@/lib/challenge/config";
import type { Difficulty } from "@/lib/challenge/difficulty";
import type { Question, Stats } from "@/lib/challenge/types";
import { chosenWordExplanation } from "@/lib/challenge/option-gloss";
import { database } from "./db";
import { HttpError } from "./http";
type Attempt = {
  id: string;
  word_id: string;
  choices: string;
  created_at: number;
  answered_at: number | null;
  selected: number | null;
  is_correct: number | null;
  question_type: QuestionType;
  answer: string | null;
  prompt: string | null;
};
/**
 * The easiest bands, for an account that has never answered a question. Returns
 * null once there is any history, or when the pool is too narrow for the
 * restriction to leave anything to ask.
 */
const STARTER_BANDS: Difficulty[] = [0, 1, 2];
export async function starterBand(
  userId: string,
  available: readonly Word[],
): Promise<Word[] | null> {
  const answered = (
    await database()
      .prepare(
        "SELECT COUNT(*) AS count FROM attempts WHERE user_id=? AND answered_at IS NOT NULL",
      )
      .bind(userId)
      .first<{ count: number }>()
  )?.count;
  if (answered) return null;
  const easy = available.filter((word) =>
    STARTER_BANDS.includes(levelFor(word.id) as Difficulty),
  );
  // Never narrow a pool to nothing.
  return easy.length >= 8 ? easy : null;
}

/**
 * Whole days between the last day this word was shown and today, or undefined
 * if it has not been shown before.
 *
 * Counted in reporting days rather than 24-hour blocks, so "yesterday" means
 * yesterday to the child rather than whatever hour the session started.
 */
function daysSince(lastSeen: string | null | undefined): number | undefined {
  if (!lastSeen) return undefined;
  const then = Date.parse(`${lastSeen}T00:00:00Z`);
  const now = Date.parse(`${localDay(Date.now())}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return undefined;
  const days = Math.round((now - then) / 86400000);
  return days > 0 ? days : undefined;
}

/** Resolves a lower-cased word to its bank entry, for the wrong-answer gloss. */
const glossLookup = (word: string) => {
  const entry = words.find(
    (candidate) => candidate.word.toLowerCase() === word,
  );
  return entry
    ? {
        word: entry.word,
        definition: storyMeaning(entry),
        example: entry.example,
      }
    : undefined;
};

export const levelFor = (id: string) =>
  // The generated bank carries the level for every word it holds. A parent's own
  // word is not in it, so it falls back to the word's length.
  levelOf.get(id) ?? difficultyForAddedWord(id.replace(/^own:/, "")).difficulty;
/** Credit-bearing correct answers per word, so a mastered word cannot farm credits. */
const ELIGIBLE_ANSWERS = 5;
type WordProgress = {
  mastered?: number;
  run?: number;
  recalls?: number;
  word_id: string;
  correct: number;
  seen: number;
  /** The reporting day this word was last shown, so feedback can say how long ago. */
  last_seen: string | null;
  retry_at: number | null;
};
/**
 * The two single-word reads, which only ever want the counters and not the
 * rotation columns. Giving them their own type rather than casting to the whole
 * row is what stops a column going missing from one query and being read as
 * `undefined` from another: a narrower type cannot pretend to carry a column
 * nobody selected.
 */
type WordCounters = Pick<
  WordProgress,
  "correct" | "run" | "recalls" | "mastered" | "last_seen"
>;
export async function statsFor(
  userId: string,
  wordIds?: ReadonlySet<string>,
): Promise<Stats> {
  // The legacy backfill has to land first: it writes learning_events and
  // study_ticks, and the triggers on those maintain the very counters read
  // below. Reading before it ran would report a stale balance for an account
  // that had not been initialised yet. Everything after it is independent.
  await initializeRewards(userId);
  // Read in one batch. These were five sequential round trips, and this function
  // runs after both the answer and the next question, so it was ten of the
  // round trips a child waited through per question.
  const reads = await summaryReads(userId, {
    mission: true,
    progress: Boolean(wordIds),
  });
  const summary = buildSummary(reads);
  const ids = wordIds || new Set(words.map((w) => w.id));
  // A free-tier child may only have met words inside their free set, so their
  // counts have to be filtered by it and the progress table has to be read. A
  // full-access child can use the running totals the triggers already maintain,
  // which is one cheap daily_stats read instead of a scan that grows with their
  // whole history.
  const totals = summary.totals;
  const counts = wordIds
    ? {
        mastered: (reads.progress ?? []).filter(
          (p) => ids.has(p.word_id) && hasMastered(p),
        ).length,
        meetCount: (reads.progress ?? []).filter((p) => ids.has(p.word_id))
          .length,
      }
    : { mastered: totals.mastered, meetCount: totals.newWords };
  return {
    total: ids.size,
    collection: words.length,
    mission: {
      day: reads.day,
      questions: reads.mission?.questions ?? 0,
      stories: reads.mission?.stories ?? 0,
    },
    mastered: counts.mastered,
    correct: summary.periods.all.correct,
    todaySeconds: summary.periods.today.seconds,
    totalSeconds: summary.periods.all.seconds,
    meetCount: counts.meetCount,
    ...summary,
  };
}
/**
 * Resolves a word for a question or an answer.
 *
 * The pool rather than the shipped bank, because a parent's own words are
 * namespaced as own:<word> and are not in the bank. Resolving against the bank
 * meant every question about an added word threw, and because the attempt had
 * already been written, the resume path threw the same way on every subsequent
 * request, so one added word could stop practice working altogether.
 */
function wordFor(wordId: string, pool: readonly Word[]): Word | undefined {
  return pool.find((word) => word.id === wordId);
}

function toQuestion(
  attempt: Attempt,
  pool: readonly Word[],
  progress?: WordProgress,
  placement?: Placement | null,
): Question {
  const word = wordFor(attempt.word_id, pool);
  if (!word)
    throw new HttpError(409, "The word list changed. Start another question.");
  return {
    id: attempt.id,
    difficulty: levelFor(word.id),
    // Where the child is, when they did not choose a band. Null with an
    // explicit choice: the child said where they are, so there is nothing to
    // estimate and a number would look authoritative without being so.
    placement: placement ?? null,
    mastery: masteryProgress(
      {
        correct: progress?.correct ?? 0,
        run: progress?.run ?? 0,
        recalls: progress?.recalls ?? 0,
        mastered: hasMastered(progress ?? initialMastery),
      },
      levelFor(word.id),
    ),
    word: word.word,
    // The word carries its own clue, so this reads a field rather than opening a
    // second data file to find one.
    clue: wordClue(
      word,
      attempt.answer ?? word.definition,
      attempt.question_type,
    ),
    wordId: word.id,
    type: attempt.question_type,
    prompt: attempt.prompt || `Choose the definition for '${word.word}'.`,
    source: word.source,
    number: pool.findIndex((entry) => entry.id === word.id) + 1,
    choices: JSON.parse(attempt.choices),
    correctCount: progress?.correct || 0,
    seen: progress?.seen || 0,
  };
}
export async function nextQuestion(
  userId: string,
  types: QuestionType[],
  allowedWordIds?: ReadonlySet<string>,
  level: Difficulty | null = null,
) {
  const db = database();
  // A parent's own settings: words set aside, and words they added.
  const [excluded, added] = await Promise.all([
    excludedWordIds(userId),
    customWordsFor(userId),
  ]);
  const pool = practiceWordsFor(added, excluded);
  const bankWordIds = new Set(words.map((word) => word.id));
  const poolProblems = problems.filter(
    (problem) => !excluded.has(problem.wordId),
  );
  const customProblems = problemsForAddedWords(
    pool.filter((word) => !bankWordIds.has(word.id)),
    words,
  );
  const allProblems = [...poolProblems, ...customProblems];
  // Only the columns this function reads. This used to be "SELECT *", which
  // pulled the user's entire progress row set across the network on every
  // question handed out, including every word they had already retired.
  //
  // Database time is free against a Worker's CPU budget and still costs the
  // child a round trip's worth of waiting, which is the part they feel.
  //
  // "The columns this function reads" has to be taken literally. `seen` was
  // dropped from this list while narrowing it, and because the result is cast
  // rather than checked, the type said `seen: number` while the row had no such
  // field. Nothing threw: every read became `undefined || 0`, so the "New
  // word" badge showed for words the child had met twenty times and the
  // least-seen-first balancing in chooseWord silently stopped balancing. No
  // test covered it, because the tests never seeded a word that had been seen
  // more than once. tests/mastery.integration.mjs now seeds one.
  //
  // The rows are deliberately *not* narrowed to unretired words. Any
  // "WHERE user_id = ?" predicate seeks the primary key and visits every one of
  // that child's rows, so filtering here saves no database work at all, and it
  // hides the rows that decide retirement: a mastered word would then be absent
  // from the map, read as never seen, and handed back out as a question.
  const rows = (
    await db
      .prepare(
        "SELECT word_id,correct,run,recalls,mastered,seen,last_seen,retry_at FROM progress WHERE user_id = ?",
      )
      .bind(userId)
      .all<WordProgress>()
  ).results;
  const byId = new Map(rows.map((p) => [p.word_id, p]));
  const eligible = allProblems.filter((problem) =>
    types.includes(problem.type),
  );
  const eligibleWordIds = new Set(eligible.map((problem) => problem.wordId));
  const available = pool.filter(
    (w) =>
      eligibleWordIds.has(w.id) &&
      (level === null || levelFor(w.id) === level) &&
      isAllowedWord(w.id, allowedWordIds) &&
      // Absent means never practised, which is available. Present means the row
      // itself decides: a word is retired either by the flag or by reaching the
      // cumulative floor without it being set.
      !hasMastered(byId.get(w.id) ?? initialMastery),
  );
  // Where the child is, when they did not choose a band. Read from
  // `learning_events` via the shared reader — the question route, the score
  // chart and the story library must share one definition of "recent", or the
  // badge, the line and the recommendation will disagree about the same child.
  // Skipped entirely with an explicit choice: with nothing to estimate, there
  // is nothing to read and the placement stays null.
  const trailing: TrailingAnswer[] =
    level === null ? await trailingAnswers(userId) : [];
  // Fractions run over the eligible pool rather than the starter-narrowed one,
  // so the estimate describes the child's knowledge and not the fresh-account
  // guard below. The browser engine derives the same number from the same rows,
  // which is what keeps the two question paths in agreement.
  const placementOf = (): Placement | null => {
    if (level !== null) return null;
    const totals = [0, 0, 0, 0, 0, 0];
    const items: Array<{ level: number; mastered: boolean; correct: number }> =
      [];
    for (const word of pool) {
      if (!eligibleWordIds.has(word.id)) continue;
      if (!isAllowedWord(word.id, allowedWordIds)) continue;
      const band = levelFor(word.id);
      if (band < 0 || band > 5) continue;
      totals[band] += 1;
      items.push({
        level: band,
        mastered: hasMastered(byId.get(word.id) ?? initialMastery),
        correct: byId.get(word.id)?.correct ?? 0,
      });
    }
    const fractions = levelFractions(items, totals);
    const base = currentLevel(fractions, trailing);
    const placedLevel = currentLevel(
      fractions,
      trailing,
      stretchFraction(items, totals, base) >= 1,
    );
    return {
      level: placedLevel,
      score: levelScore(placedLevel, fractions[placedLevel] ?? 0),
    };
  };
  const pending = await db
    .prepare(
      "SELECT * FROM attempts WHERE user_id = ? AND answered_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<Attempt>();
  if (pending) {
    const currentWord = pool.find((w) => w.id === pending.word_id);
    const currentProblem = allProblems.find(
      (problem) => problem.id === `${pending.question_type}:${pending.word_id}`,
    );
    if (
      currentWord &&
      (level === null || levelFor(currentWord.id) === level) &&
      isAllowedWord(pending.word_id, allowedWordIds) &&
      currentProblem &&
      types.includes(pending.question_type) &&
      (pending.answer || currentWord.definition) === currentProblem.answer &&
      JSON.parse(pending.choices).includes(currentProblem.answer)
    )
      return toQuestion(
        pending,
        pool,
        byId.get(pending.word_id),
        placementOf(),
      );
    // Retire a pending question when its word was removed or its definition edited.
    await db
      .prepare(
        "UPDATE attempts SET answered_at=?,selected=-2,is_correct=0 WHERE id=? AND user_id=? AND answered_at IS NULL",
      )
      .bind(Date.now(), pending.id, userId)
      .run();
  }
  // `available`, `eligible` and `eligibleWordIds` are computed above, before
  // the pending check, so the placement estimate can read them. The filter is
  // pure and the rows have not changed since.
  if (!available.length) return null;
  // A child who has never answered anything starts on the easier bands rather
  // than being handed a uniformly random word out of 2,249, which is a
  // one-in-six chance of opening on a Level 5 word like "incontrovertible" with
  // no idea what it means. The wider range opens as soon as there is any
  // history, and a chosen level always overrides this.
  const chosen = await starterBand(userId, available);
  const startable = chosen ?? available;
  const count =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ?")
        .bind(userId)
        .first<{ count: number }>()
    )?.count || 0;
  const recent = (
    await db
      .prepare(
        "SELECT word_id FROM attempts WHERE user_id = ? GROUP BY word_id ORDER BY MAX(rowid) DESC",
      )
      .bind(userId)
      .all<{ word_id: string }>()
  ).results;
  // Automatic placement, only when the child did not pick a band. Due
  // mistake-reviews anywhere bypass the draw — the spaced-repetition clock
  // outranks the band plan — otherwise a band is drawn from the allocation
  // weights and the word is picked inside it. An explicit level choice keeps
  // the exact filter applied above, and a drawn band with nothing to ask
  // leaves the starter set in place rather than returning nothing.
  const placed = placementOf();
  let bandWords = startable;
  if (placed) {
    const owed = startable.some((word) => {
      const retryAt = byId.get(word.id)?.retry_at ?? null;
      return retryAt !== null && retryAt <= count;
    });
    if (!owed) {
      // The stretch follows the same readiness the browser derives from the
      // same rows, which is what keeps the two question paths in agreement.
      const fracTotals = [0, 0, 0, 0, 0, 0];
      const fracItems: Array<{ level: number; correct: number }> = [];
      for (const word of pool) {
        if (!eligibleWordIds.has(word.id)) continue;
        if (!isAllowedWord(word.id, allowedWordIds)) continue;
        const band = levelFor(word.id);
        if (band < 0 || band > 5) continue;
        fracTotals[band] += 1;
        fracItems.push({
          level: band,
          correct: byId.get(word.id)?.correct ?? 0,
        });
      }
      bandWords = narrowToBand(
        startable,
        (word) => levelFor(word.id),
        allocationFor(
          placed.level,
          stretchFraction(fracItems, fracTotals, placed.level),
        ),
        Math.random,
      ).words;
    }
  }
  const chosenId = chooseWord(
    bandWords.map((word) => ({
      id: word.id,
      seen: byId.get(word.id)?.seen || 0,
      retryAt: byId.get(word.id)?.retry_at ?? null,
    })),
    recent.map((attempt) => attempt.word_id),
    count,
  );
  const word = startable.find((word) => word.id === chosenId)!;
  const wordProblems = eligible.filter((problem) => problem.wordId === word.id);
  // Cycle through eligible types for a word before repeating, while selection remains word-based.
  const history = (
    await db
      .prepare(
        "SELECT question_type,COUNT(*) AS count FROM attempts WHERE user_id=? AND word_id=? AND answered_at IS NOT NULL AND selected>=-1 GROUP BY question_type",
      )
      .bind(userId, word.id)
      .all<{ question_type: QuestionType; count: number }>()
  ).results;
  const counts = new Map(history.map((row) => [row.question_type, row.count]));
  const leastSeen = Math.min(
    ...wordProblems.map((problem) => counts.get(problem.type) || 0),
  );
  const candidates = wordProblems.filter(
    (problem) => (counts.get(problem.type) || 0) === leastSeen,
  );
  const problem = candidates[Math.floor(Math.random() * candidates.length)];
  // Generated first so the definition distractors can be seeded from it: the
  // same word then comes with a different set of wrong options each time,
  // rather than the child learning to eliminate the same three.
  const attemptId = crypto.randomUUID();
  const attempt: Attempt = {
    id: attemptId,
    word_id: word.id,
    choices: JSON.stringify(shuffle(choicesForProblem(problem))),
    question_type: problem.type,
    answer: problem.answer,
    prompt: problem.prompt,
    created_at: Date.now(),
    answered_at: null,
    selected: null,
    is_correct: null,
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO attempts (id,user_id,word_id,choices,created_at,question_type,answer,prompt,elapsed) VALUES (?,?,?,?,?,?,?,?,0)",
        )
        .bind(
          attempt.id,
          userId,
          word.id,
          attempt.choices,
          attempt.created_at,
          attempt.question_type,
          attempt.answer,
          attempt.prompt,
        ),
      db
        .prepare(
          "INSERT INTO progress (user_id,word_id,correct,seen,last_seen,retry_at) VALUES (?,?,0,1,?,NULL) ON CONFLICT(user_id,word_id) DO UPDATE SET seen=seen+1,last_seen=excluded.last_seen,retry_at=NULL",
        )
        .bind(userId, word.id, localDay(Date.now())),
    ]);
  } catch (error) {
    // A second tab may have created a pending question concurrently.
    const existing = await db
      .prepare("SELECT * FROM attempts WHERE user_id=? AND answered_at IS NULL")
      .bind(userId)
      .first<Attempt>();
    if (existing && types.includes(existing.question_type))
      return toQuestion(existing, pool, byId.get(existing.word_id), placed);
    if (existing)
      throw new HttpError(
        409,
        "Another tab changed the practice type. Please try again.",
      );
    throw error;
  }
  const prior = byId.get(word.id);
  return toQuestion(
    attempt,
    pool,
    {
      word_id: word.id,
      correct: prior?.correct || 0,
      mastered: prior?.mastered ?? 0,
      run: prior?.run ?? 0,
      recalls: prior?.recalls ?? 0,
      seen: (prior?.seen || 0) + 1,
      last_seen: localDay(Date.now()),
      retry_at: null,
    },
    placed,
  );
}
export async function answerQuestion(
  userId: string,
  id: string,
  selected: number,
  elapsed: number,
  allowedWordIds?: ReadonlySet<string>,
  assisted = false,
) {
  const db = database();
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<Attempt>();
  if (!attempt) throw new HttpError(404, "Question not found.");
  const pool = practiceWordsFor(
    await customWordsFor(userId),
    await excludedWordIds(userId),
  );
  const word = wordFor(attempt.word_id, pool);
  if (!word) throw new HttpError(409, "The word list changed. Please reload.");
  if (!isAllowedWord(word.id, allowedWordIds))
    throw new HttpError(
      409,
      "This question is outside your free collection. Loading another question.",
    );
  const options = JSON.parse(attempt.choices) as string[];
  if (attempt.selected === -2)
    throw new HttpError(
      409,
      "This question was replaced when practice settings changed. Continue with the current question.",
    );
  if (
    !Number.isInteger(selected) ||
    selected < -1 ||
    selected >= options.length
  )
    throw new HttpError(400, "Choose a valid answer.");
  await initializeRewards(userId);
  const answer = attempt.answer || word.definition;
  const correct = options[selected] === answer;
  const count =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ?")
        .bind(userId)
        .first<{ count: number }>()
    )?.count || 0;
  const due = reviewDueAt(count);
  const now = Date.now();
  const wallSeconds = (now - attempt.created_at) / 1000;
  // The stored time is the trustworthy one, so the evidence verdict can be
  // reproduced from this row later.
  const seconds = Math.max(
    0,
    Math.min(300, Math.floor(wallSeconds), Math.floor(elapsed)),
  );
  const revealed = selected === -1;
  const level = levelFor(word.id);
  const evidence: Evidence = classify({
    correct,
    revealed,
    assisted,
    seconds,
    wallSeconds,
    window: answerWindow(options),
  });
  // Mastery is decided by the shared pure function, not by SQL. Reading the row here
  // is safe because attempts_one_pending_per_user allows only one live question per
  // user, so no other write to this word can interleave.
  const prior =
    (await db
      .prepare(
        "SELECT correct,run,recalls,mastered,last_seen FROM progress WHERE user_id=? AND word_id=?",
      )
      .bind(userId, word.id)
      .first<WordCounters>()) ?? initialMastery;
  const mastery = advanceMastery(
    {
      correct: prior.correct ?? 0,
      run: prior.run ?? 0,
      recalls: prior.recalls ?? 0,
      mastered: hasMastered(prior),
    },
    evidence,
    level,
  );
  // The word is finished either way, but only a right answer may pay the mastery
  // bonus, so a stale row that already met the floor cannot be cashed in by a miss.
  const paidMastery = correct && mastery.newlyMastered;
  // Award event, progress and answer commit together; event uniqueness prevents replay.
  await db.batch([
    // A missing progress row would silently drop the answer, so make sure one exists.
    db
      .prepare(
        "INSERT INTO progress(user_id,word_id,correct,seen,retry_at) SELECT ?,?,0,0,NULL WHERE EXISTS(SELECT 1 FROM attempts WHERE id=? AND user_id=? AND answered_at IS NULL) ON CONFLICT(user_id,word_id) DO NOTHING",
      )
      .bind(userId, word.id, id, userId),
    db
      .prepare(
        `INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered,evidence)
      SELECT a.id,a.user_id,a.word_id,?,?,?,?,
        CASE WHEN ?=1 AND p.mastered=0 AND p.correct<? AND (SELECT COUNT(*) FROM learning_events e WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.eligible=1)<? THEN 1 ELSE 0 END,
        CASE WHEN ?=1 AND NOT EXISTS(SELECT 1 FROM learning_events e WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.mastered=1) THEN 1 ELSE 0 END,
        ?
      FROM attempts a JOIN progress p ON p.user_id=a.user_id AND p.word_id=a.word_id
      WHERE a.id=? AND a.user_id=? AND a.answered_at IS NULL`,
      )
      .bind(
        now,
        localDay(now),
        correct ? 1 : 0,
        revealed ? 1 : 0,
        correct ? 1 : 0,
        CUMULATIVE_FLOOR,
        ELIGIBLE_ANSWERS,
        paidMastery ? 1 : 0,
        evidence,
        id,
        userId,
      ),
    db
      .prepare(
        "UPDATE progress SET correct=?,run=?,recalls=?,mastered=?,retry_at=? WHERE user_id=? AND word_id=? AND EXISTS (SELECT 1 FROM attempts WHERE id=? AND user_id=? AND answered_at IS NULL)",
      )
      .bind(
        mastery.correct,
        mastery.run,
        mastery.recalls,
        mastery.mastered ? 1 : 0,
        correct ? null : due,
        userId,
        word.id,
        id,
        userId,
      ),
    db
      .prepare(
        "UPDATE attempts SET answered_at=?,selected=?,is_correct=?,elapsed=? WHERE id=? AND user_id=? AND answered_at IS NULL",
      )
      .bind(Date.now(), selected, correct ? 1 : 0, seconds, id, userId),
  ]);
  const saved = await db
    .prepare(
      "SELECT selected,is_correct FROM attempts WHERE id = ? AND user_id = ?",
    )
    .bind(id, userId)
    .first<{ selected: number; is_correct: number }>();
  if (saved?.selected === -2)
    throw new HttpError(
      409,
      "This question was replaced in another tab. Continue with the current question.",
    );
  // Re-read after the commit so a losing tab reports the winning values.
  const progress =
    (await db
      .prepare(
        "SELECT correct,run,recalls,mastered,last_seen FROM progress WHERE user_id=? AND word_id=?",
      )
      .bind(userId, word.id)
      .first<WordCounters>()) ?? prior;
  return {
    mastery: masteryProgress(
      {
        correct: progress.correct ?? 0,
        run: progress.run ?? 0,
        recalls: progress.recalls ?? 0,
        mastered: hasMastered(progress),
      },
      level,
    ),
    // Only the answer that finishes a word reports it, so the app can mark the
    // moment rather than congratulating a child on every answer from then on.
    newlyMastered: paidMastery,
    // How well the child actually did, as opposed to whether the answer was
    // right. The feedback wording is built from this, so "correct" and
    // "recalled" never get conflated: a child who got it right by reflex is
    // not told they knew it.
    evidence,
    // How long ago this word was last shown, in whole days, so the app can
    // say the thing that makes spacing visible: that it came back and stayed.
    daysSince: daysSince((prior as WordProgress | undefined)?.last_seen),
    // The plain-language help travels with the answer, so the learning-help
    // data never has to be downloaded by the browser.
    help: storyMeaning(word),
    attemptId: id,
    chosen: chosenWordExplanation(
      options,
      saved?.selected ?? -1,
      answer,
      glossLookup,
    ),
    type: attempt.question_type,
    answer,
    correct: Boolean(saved?.is_correct),
    skipped: saved?.selected === -1,
    definition: word.definition,
    example: word.example,
    syn: word.syn,
    ant: word.ant,
    selected: saved?.selected ?? -1,
    word: word.word,
    clue: wordClue(
      word,
      attempt.answer ?? word.definition,
      attempt.question_type,
    ),
    award: await awardFor(userId, id),
  };
}
