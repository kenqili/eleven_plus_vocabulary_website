export const RECENT_WORD_WINDOW = 20;
// Fixed spacing avoids random review dates colliding and delaying each other.
export const MISTAKE_REVIEW_DISTANCE = 15;

export function reviewDueAt(currentAttemptCount: number): number {
  // chooseWord runs before inserting the next attempt: +14 means the 15th next question.
  return currentAttemptCount + MISTAKE_REVIEW_DISTANCE - 1;
}

type Candidate = { id: string; seen: number; retryAt: number | null };

/** Recent IDs are newest first. Relax spacing only when the pool is small. */
export function chooseWord(
  candidates: Candidate[],
  recent: string[],
  attemptCount: number,
  random = Math.random,
): string | null {
  if (!candidates.length) return null;
  const due = candidates.filter(
    (word) => word.retryAt !== null && word.retryAt <= attemptCount,
  );
  if (due.length) {
    // Reviews override ordinary spacing and exposure counts. Oldest due first.
    const earliest = Math.min(...due.map((word) => word.retryAt!));
    const oldest = due.filter((word) => word.retryAt === earliest);
    return oldest[Math.floor(random() * oldest.length)].id;
  }
  // Do not accidentally repeat a mistake before its scheduled review.
  const regular = candidates.filter((word) => word.retryAt === null);
  // With only waiting mistakes left, keep practice usable rather than stall.
  const available = regular.length ? regular : candidates;
  const ids = new Set(available.map((word) => word.id));
  const excluded = new Set(
    [...new Set(recent.filter((id) => ids.has(id)))].slice(
      0,
      Math.min(RECENT_WORD_WINDOW, available.length - 1),
    ),
  );
  const pool = available.filter((word) => !excluded.has(word.id));
  const leastSeen = Math.min(...pool.map((word) => word.seen));
  const balanced = pool.filter((word) => word.seen === leastSeen);
  return balanced[Math.floor(random() * balanced.length)].id;
}

/** One question per word per shuffled round; never group a word's types. */
export function interleaveQuestions<T extends { wordId: string }>(
  questions: T[],
  random = Math.random,
): T[] {
  const shuffle = <U>(values: U[]) => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const groups = new Map<string, T[]>();
  for (const question of shuffle(questions)) {
    groups.set(question.wordId, [
      ...(groups.get(question.wordId) || []),
      question,
    ]);
  }
  const result: T[] = [];
  while (groups.size) {
    const round = shuffle([...groups.keys()]);
    if (round.length > 1 && round[0] === result.at(-1)?.wordId) {
      [round[0], round[1]] = [round[1], round[0]];
    }
    for (const id of round) {
      const group = groups.get(id)!;
      result.push(group.pop()!);
      if (!group.length) groups.delete(id);
    }
  }
  return result;
}
