export const RECENT_WORD_WINDOW = 20;

type Candidate = { id: string; seen: number; retryAt: number | null };

/** Recent IDs are newest first. Relax spacing only when the pool is small. */
export function chooseWord(
  candidates: Candidate[],
  recent: string[],
  attemptCount: number,
  random = Math.random,
): string | null {
  if (!candidates.length) return null;
  const ids = new Set(candidates.map((word) => word.id));
  const excluded = new Set(
    [...new Set(recent.filter((id) => ids.has(id)))].slice(
      0,
      Math.min(RECENT_WORD_WINDOW, candidates.length - 1),
    ),
  );
  const spaced = candidates.filter((word) => !excluded.has(word.id));
  const due = spaced.filter(
    (word) => word.retryAt !== null && word.retryAt <= attemptCount,
  );
  const pool = due.length ? due : spaced;
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
