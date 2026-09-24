import levels from "@/data/word-levels/levels.json";
import { words } from "@/lib/challenge/bank";
import type { Word } from "@/lib/challenge/words";
import { configuredFreeWordLimit } from "./billing";

/** Return a stable, difficulty-balanced selection for signed-out and post-trial access. */
export function freeWords(limit = configuredFreeWordLimit()): Word[] {
  const buckets = [1, 2, 3, 4, 5].map((difficulty) =>
    words
      .filter(
        (word) =>
          levels.words[word.id as keyof typeof levels.words]?.difficulty ===
          difficulty,
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  const selected: Word[] = [];
  while (selected.length < Math.min(limit, words.length)) {
    let added = false;
    for (const bucket of buckets) {
      if (!bucket.length || selected.length >= limit) continue;
      selected.push(bucket.shift()!);
      added = true;
    }
    if (!added) break;
  }
  return selected;
}
export function freeWordIds(limit = configuredFreeWordLimit()) {
  return new Set(freeWords(limit).map((word) => word.id));
}
