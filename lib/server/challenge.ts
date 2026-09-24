import { initializeRewards, progressSummary, awardFor } from "./rewards";
import { localDay } from "@/lib/challenge/rewards";
import { chooseWord, reviewDueAt } from "@/lib/challenge/ordering";
import { words, problems, problemById } from "@/lib/challenge/bank";
import { choicesFor, shuffle } from "@/lib/challenge/words";
import { MASTERY_TARGET, type QuestionType } from "@/lib/challenge/config";
import type { Question, Stats } from "@/lib/challenge/types";
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
type WordProgress = {
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
    .prepare("SELECT word_id,correct FROM progress WHERE user_id = ?")
    .bind(userId)
    .all<{ word_id: string; correct: number }>();
  const ids = wordIds || new Set(words.map((w) => w.id));
  const mastered = rows.results.filter(
    (p) => ids.has(p.word_id) && p.correct >= MASTERY_TARGET,
  ).length;
  const summary = await progressSummary(userId);
  return {
    total: ids.size,
    mastered,
    correct: summary.periods.all.correct,
    todaySeconds: summary.periods.today.seconds,
    totalSeconds: summary.periods.all.seconds,
    inProgress: rows.results.filter(
      (p) => ids.has(p.word_id) && p.correct > 0 && p.correct < MASTERY_TARGET,
    ).length,
    ...summary,
  };
}
function toQuestion(attempt: Attempt, progress?: WordProgress): Question {
  const index = words.findIndex((w) => w.id === attempt.word_id);
  const word = words[index];
  if (!word)
    throw new HttpError(409, "The word list changed. Start another question.");
  return {
    id: attempt.id,
    word: word.word,
    wordId: word.id,
    type: attempt.question_type,
    prompt: attempt.prompt || `Choose the definition for '${word.word}'.`,
    source: word.source,
    number: index + 1,
    choices: JSON.parse(attempt.choices),
    correctCount: progress?.correct || 0,
    seen: progress?.seen || 0,
  };
}
export async function nextQuestion(
  userId: string,
  types: QuestionType[],
  allowedWordIds?: ReadonlySet<string>,
) {
  const db = database();
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
    const currentWord = words.find((w) => w.id === pending.word_id);
    const currentProblem = problemById.get(
      `${pending.question_type}:${pending.word_id}`,
    );
    if (
      currentWord &&
      (!allowedWordIds || allowedWordIds.has(pending.word_id)) &&
      currentProblem &&
      types.includes(pending.question_type) &&
      (pending.answer || currentWord.definition) === currentProblem.answer &&
      JSON.parse(pending.choices).includes(currentProblem.answer)
    )
      return toQuestion(pending, byId.get(pending.word_id));
    // Retire a pending question when its word was removed or its definition edited.
    await db
      .prepare(
        "UPDATE attempts SET answered_at=?,selected=-2,is_correct=0 WHERE id=? AND user_id=? AND answered_at IS NULL",
      )
      .bind(Date.now(), pending.id, userId)
      .run();
  }
  const eligible = problems.filter((problem) => types.includes(problem.type));
  const eligibleWordIds = new Set(eligible.map((problem) => problem.wordId));
  const available = words.filter(
    (w) =>
      eligibleWordIds.has(w.id) &&
      (!allowedWordIds || allowedWordIds.has(w.id)) &&
      (byId.get(w.id)?.correct || 0) < MASTERY_TARGET,
  );
  if (!available.length) return null;
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
    available.map((word) => ({
      id: word.id,
      seen: byId.get(word.id)?.seen || 0,
      retryAt: byId.get(word.id)?.retry_at ?? null,
    })),
    recent.map((attempt) => attempt.word_id),
    count,
  );
  const word = available.find((word) => word.id === chosenId)!;
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
  const attempt: Attempt = {
    id: crypto.randomUUID(),
    word_id: word.id,
    choices: JSON.stringify(
      problem.choices ? shuffle(problem.choices) : choicesFor(word, words),
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
      return toQuestion(existing, byId.get(existing.word_id));
    if (existing)
      throw new HttpError(
        409,
        "Another tab changed the practice type. Please try again.",
      );
    throw error;
  }
  const prior = byId.get(word.id);
  return toQuestion(attempt, {
    word_id: word.id,
    correct: prior?.correct || 0,
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
) {
  const db = database();
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<Attempt>();
  if (!attempt) throw new HttpError(404, "Question not found.");
  const word = words.find((w) => w.id === attempt.word_id);
  if (!word) throw new HttpError(409, "The word list changed. Please reload.");
  if (allowedWordIds && !allowedWordIds.has(word.id))
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
  const seconds = Math.max(
    0,
    Math.min(
      300,
      Math.floor((Date.now() - attempt.created_at) / 1000),
      Math.floor(elapsed),
    ),
  );
  const now = Date.now();
  // Award event, progress and answer commit together; event uniqueness prevents replay.
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered)
      SELECT a.id,a.user_id,a.word_id,?,?,?,?,
        CASE WHEN ?=1 AND p.correct<5 AND (SELECT COUNT(*) FROM learning_events e WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.eligible=1)<5 THEN 1 ELSE 0 END,
        CASE WHEN ?=1 AND p.correct=4 AND NOT EXISTS(SELECT 1 FROM learning_events e WHERE e.user_id=a.user_id AND e.word_id=a.word_id AND e.mastered=1) THEN 1 ELSE 0 END
      FROM attempts a JOIN progress p ON p.user_id=a.user_id AND p.word_id=a.word_id
      WHERE a.id=? AND a.user_id=? AND a.answered_at IS NULL`,
      )
      .bind(
        now,
        localDay(now),
        correct ? 1 : 0,
        selected === -1 ? 1 : 0,
        correct ? 1 : 0,
        correct ? 1 : 0,
        id,
        userId,
      ),
    db
      .prepare(
        "UPDATE progress SET correct=MIN(?,correct+?),retry_at=? WHERE user_id=? AND word_id=? AND EXISTS (SELECT 1 FROM attempts WHERE id=? AND user_id=? AND answered_at IS NULL)",
      )
      .bind(
        MASTERY_TARGET,
        correct ? 1 : 0,
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
  return {
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
    award: await awardFor(userId, id),
  };
}
