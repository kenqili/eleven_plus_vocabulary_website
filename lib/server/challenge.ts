import { words } from "@/lib/challenge/bank";
import { choicesFor } from "@/lib/challenge/words";
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
};
type WordProgress = {
  word_id: string;
  correct: number;
  seen: number;
  retry_at: number | null;
};
export async function statsFor(userId: string): Promise<Stats> {
  const rows = await database()
    .prepare("SELECT word_id,correct FROM progress WHERE user_id = ?")
    .bind(userId)
    .all<{ word_id: string; correct: number }>();
  const ids = new Set(words.map((w) => w.id));
  const mastered = rows.results.filter(
    (p) => ids.has(p.word_id) && p.correct >= 3,
  ).length;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const totals = await database()
    .prepare(
      "SELECT COALESCE(SUM(is_correct),0) AS correct, COALESCE(SUM(elapsed),0) AS total, COALESCE(SUM(CASE WHEN answered_at >= ? THEN elapsed ELSE 0 END),0) AS today FROM attempts WHERE user_id = ?",
    )
    .bind(start.getTime(), userId)
    .first<{ correct: number; total: number; today: number }>();
  return {
    total: words.length,
    mastered,
    correct: totals?.correct || 0,
    todaySeconds: totals?.today || 0,
    totalSeconds: totals?.total || 0,
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
    source: word.source,
    number: index + 1,
    choices: JSON.parse(attempt.choices),
    correctCount: progress?.correct || 0,
    seen: progress?.seen || 0,
  };
}
export async function nextQuestion(userId: string) {
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
    if (
      currentWord &&
      JSON.parse(pending.choices).includes(currentWord.definition)
    )
      return toQuestion(pending, byId.get(pending.word_id));
    // Retire a pending question when its word was removed or its definition edited.
    await db
      .prepare(
        "UPDATE attempts SET answered_at=?,selected=-1,is_correct=0 WHERE id=? AND user_id=? AND answered_at IS NULL",
      )
      .bind(Date.now(), pending.id, userId)
      .run();
  }
  const available = words.filter((w) => (byId.get(w.id)?.correct || 0) < 3);
  if (!available.length) return null;
  const count =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ?")
        .bind(userId)
        .first<{ count: number }>()
    )?.count || 0;
  const previous = await db
    .prepare(
      "SELECT word_id FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<{ word_id: string }>();
  const due = available.filter(
    (w) =>
      byId.get(w.id)?.retry_at != null && byId.get(w.id)!.retry_at! <= count,
  );
  const regular = available.filter(
    (w) => byId.get(w.id)?.retry_at == null && w.id !== previous?.word_id,
  );
  const pool = due.length
    ? due
    : regular.length
      ? regular
      : available.filter((w) => w.id !== previous?.word_id);
  const word = (pool.length ? pool : available)[
    Math.floor(Math.random() * (pool.length || available.length))
  ];
  const attempt: Attempt = {
    id: crypto.randomUUID(),
    word_id: word.id,
    choices: JSON.stringify(choicesFor(word, words)),
    created_at: Date.now(),
    answered_at: null,
    selected: null,
    is_correct: null,
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO attempts (id,user_id,word_id,choices,created_at,elapsed) VALUES (?,?,?,?,?,0)",
        )
        .bind(attempt.id, userId, word.id, attempt.choices, attempt.created_at),
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
    if (existing) return toQuestion(existing, byId.get(existing.word_id));
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
) {
  const db = database();
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<Attempt>();
  if (!attempt) throw new HttpError(404, "Question not found.");
  const word = words.find((w) => w.id === attempt.word_id);
  if (!word) throw new HttpError(409, "The word list changed. Please reload.");
  const options = JSON.parse(attempt.choices) as string[];
  if (
    !Number.isInteger(selected) ||
    selected < -1 ||
    selected >= options.length
  )
    throw new HttpError(400, "Choose a valid answer.");
  const correct = options[selected] === word.definition;
  const count =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ?")
        .bind(userId)
        .first<{ count: number }>()
    )?.count || 0;
  const due = count + 5 + Math.floor(Math.random() * 16);
  const seconds = Math.max(
    0,
    Math.min(
      300,
      Math.floor((Date.now() - attempt.created_at) / 1000),
      Math.floor(elapsed),
    ),
  );
  // D1 batches are transactional: only an unanswered attempt can increment mastery.
  await db.batch([
    db
      .prepare(
        "UPDATE progress SET correct=MIN(3,correct+?),retry_at=? WHERE user_id=? AND word_id=? AND EXISTS (SELECT 1 FROM attempts WHERE id=? AND user_id=? AND answered_at IS NULL)",
      )
      .bind(correct ? 1 : 0, correct ? null : due, userId, word.id, id, userId),
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
  return {
    correct: Boolean(saved?.is_correct),
    skipped: saved?.selected === -1,
    definition: word.definition,
    example: word.example,
    syn: word.syn,
    ant: word.ant,
    selected: saved?.selected ?? -1,
    word: word.word,
  };
}
