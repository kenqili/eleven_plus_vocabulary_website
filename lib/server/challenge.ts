import levels from "@/data/word-levels/levels.json";
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
import { initializeRewards, progressSummary, awardFor } from "./rewards";
import { storyMeaning, wordClue } from "@/lib/challenge/story-meanings";
import { missionFor } from "./mission";
import { localDay } from "@/lib/challenge/rewards";
import { chooseWord, reviewDueAt } from "@/lib/challenge/ordering";
import { words, problems, distractorContext } from "@/lib/challenge/bank";
import { isAllowedWord } from "./free-words";
import { problemsForAddedWords } from "@/lib/challenge/problems";
import {
  customWordsFor,
  excludedWordIds,
  practiceWordsFor,
} from "./parent-words";
import { difficultyForAddedWord } from "@/lib/challenge/added-words";
import { choicesFor, shuffle, type Word } from "@/lib/challenge/words";
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

/** Resolves a lower-cased word to its bank entry, for the wrong-answer gloss. */
const glossLookup = (word: string) => {
  const entry = words.find((candidate) => candidate.word.toLowerCase() === word);
  return entry
    ? {
        word: entry.word,
        definition: storyMeaning(entry),
        example: entry.example,
      }
    : undefined;
};

export const levelFor = (id: string) =>
  (levels.words as Record<string, { difficulty: number }>)[id]?.difficulty ??
  // A parent's own word has no level snapshot, so fall back to its length.
  difficultyForAddedWord(id.replace(/^own:/, "")).difficulty;
/** Credit-bearing correct answers per word, so a mastered word cannot farm credits. */
const ELIGIBLE_ANSWERS = 5;
type WordProgress = {
  mastered?: number;
  run?: number;
  recalls?: number;
  word_id: string;
  correct: number;
  seen: number;
  retry_at: number | null;
};
export async function statsFor(
  userId: string,
  wordIds?: ReadonlySet<string>,
): Promise<Stats> {
  const rows = await database()
    .prepare("SELECT word_id,correct,mastered FROM progress WHERE user_id = ?")
    .bind(userId)
    .all<{ word_id: string; correct: number; mastered: number }>();
  const ids = wordIds || new Set(words.map((w) => w.id));
  const mastered = rows.results.filter(
    (p) => ids.has(p.word_id) && hasMastered(p),
  ).length;
  const summary = await progressSummary(userId);
  return {
    total: ids.size,
    collection: words.length,
    mission: await missionFor(userId),
    mastered,
    correct: summary.periods.all.correct,
    todaySeconds: summary.periods.today.seconds,
    totalSeconds: summary.periods.all.seconds,
    inProgress: rows.results.filter(
      (p) => ids.has(p.word_id) && p.correct > 0 && !hasMastered(p),
    ).length,
    meetCount: rows.results.filter((p) => ids.has(p.word_id)).length,
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
function wordFor(
  wordId: string,
  pool: readonly Word[],
): Word | undefined {
  return pool.find((word) => word.id === wordId);
}

function toQuestion(
  attempt: Attempt,
  pool: readonly Word[],
  progress?: WordProgress,
): Question {
  const word = wordFor(attempt.word_id, pool);
  if (!word)
    throw new HttpError(409, "The word list changed. Start another question.");
  return {
    id: attempt.id,
    difficulty: levelFor(word.id),
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
    clue: wordClue(
      word.id,
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
  const rows = (
    await db
      .prepare("SELECT * FROM progress WHERE user_id = ?")
      .bind(userId)
      .all<WordProgress>()
  ).results;
  const byId = new Map(rows.map((p) => [p.word_id, p]));
  const pending = await db
    .prepare(
      "SELECT * FROM attempts WHERE user_id = ? AND answered_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<Attempt>();
  if (pending) {
    const currentWord = pool.find((w) => w.id === pending.word_id);
    const currentProblem = allProblems.find(
      (problem) =>
        problem.id === `${pending.question_type}:${pending.word_id}`,
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
      return toQuestion(pending, pool, byId.get(pending.word_id));
    // Retire a pending question when its word was removed or its definition edited.
    await db
      .prepare(
        "UPDATE attempts SET answered_at=?,selected=-2,is_correct=0 WHERE id=? AND user_id=? AND answered_at IS NULL",
      )
      .bind(Date.now(), pending.id, userId)
      .run();
  }
  const eligible = allProblems.filter((problem) =>
    types.includes(problem.type),
  );
  const eligibleWordIds = new Set(eligible.map((problem) => problem.wordId));
  const available = pool.filter(
    (w) =>
      eligibleWordIds.has(w.id) &&
      (level === null || levelFor(w.id) === level) &&
      isAllowedWord(w.id, allowedWordIds) &&
      !hasMastered(byId.get(w.id) ?? initialMastery),
  );
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
  const chosenId = chooseWord(
    startable.map((word) => ({
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
    choices: JSON.stringify(
      problem.choices
        ? shuffle(problem.choices)
        : choicesFor(word, distractorContext, attemptId),
    ),
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
          "INSERT INTO progress (user_id,word_id,correct,seen,retry_at) VALUES (?,?,0,1,NULL) ON CONFLICT(user_id,word_id) DO UPDATE SET seen=seen+1,retry_at=NULL",
        )
        .bind(userId, word.id),
    ]);
  } catch (error) {
    // A second tab may have created a pending question concurrently.
    const existing = await db
      .prepare("SELECT * FROM attempts WHERE user_id=? AND answered_at IS NULL")
      .bind(userId)
      .first<Attempt>();
    if (existing && types.includes(existing.question_type))
      return toQuestion(existing, pool, byId.get(existing.word_id));
    if (existing)
      throw new HttpError(
        409,
        "Another tab changed the practice type. Please try again.",
      );
    throw error;
  }
  const prior = byId.get(word.id);
  return toQuestion(attempt, pool, {
    word_id: word.id,
    correct: prior?.correct || 0,
    mastered: prior?.mastered ?? 0,
    run: prior?.run ?? 0,
    recalls: prior?.recalls ?? 0,
    seen: (prior?.seen || 0) + 1,
    retry_at: null,
  });
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
  const pool = practiceWordsFor(await customWordsFor(userId), await excludedWordIds(userId));
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
        "SELECT correct,run,recalls,mastered FROM progress WHERE user_id=? AND word_id=?",
      )
      .bind(userId, word.id)
      .first<WordProgress>()) ?? initialMastery;
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
        "SELECT correct,run,recalls,mastered FROM progress WHERE user_id=? AND word_id=?",
      )
      .bind(userId, word.id)
      .first<WordProgress>()) ?? prior;
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
    // The plain-language help travels with the answer, so the learning-help
    // data never has to be downloaded by the browser.
    help: storyMeaning(word),
    attemptId: id,
    chosen: chosenWordExplanation(options, saved?.selected ?? -1, answer, glossLookup),
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
    clue: wordClue(word.id, attempt.answer ?? word.definition, attempt.question_type),
    award: await awardFor(userId, id),
  };
}
