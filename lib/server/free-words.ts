import levels from "@/data/word-levels/levels.json";
import { words } from "@/lib/challenge/bank";
import type { Word } from "@/lib/challenge/words";
import { configuredFreeWordLimit } from "./billing";

/** How many words the shipped collection holds. */
export const bankSize = () => words.length;

/** Prefix that marks a word a parent added, which is never part of the bank. */
export const isAddedWordId = (id: string) => id.startsWith("own:");

/**
 * Return a stable, difficulty-balanced selection for signed-out and post-trial
 * access.
 *
 * Within each difficulty band the most common words come first, because a
 * child meets the free collection before they meet anything else. Sorting
 * alphabetically instead put six words beginning "ab" in a row and opened on
 * "ablest", which is a comparative form rather than a word anyone reads.
 */
export function freeWords(limit = configuredFreeWordLimit()): Word[] {
  const rank = levels.words as Record<
    string,
    { difficulty: number; frequencyZipf: number }
  >;
  const buckets = [0, 1, 2, 3, 4, 5].map((difficulty) =>
    words
      .filter((word) => rank[word.id]?.difficulty === difficulty)
      .sort((a, b) => {
        // Most frequent first. A word with no frequency reading sorts last, so
        // it is only reached once the rest of the band is used up.
        const byFrequency =
          (rank[b.id]?.frequencyZipf ?? -1) - (rank[a.id]?.frequencyZipf ?? -1);
        if (byFrequency) return byFrequency;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
  );
  // The easy bands contribute more per round than the hard ones, so the free
  // collection starts readable and still works its way up. A flat round robin
  // put a Level 3 and a Level 5 word in every first six, which is a poor first
  // impression for a child who has not seen the app before.
  const EASY = 2;
  const selected: Word[] = [];
  while (selected.length < Math.min(limit, words.length)) {
    let added = false;
    for (const [index, bucket] of buckets.entries()) {
      const take = index <= 2 ? EASY : 1;
      for (let i = 0; i < take; i += 1) {
        if (!bucket.length || selected.length >= limit) break;
        selected.push(bucket.shift()!);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

const freeBankIds = new Map<string, Set<string>>();

export function freeWordIds(limit = configuredFreeWordLimit()) {
  let ids = freeBankIds.get(String(limit));
  if (!ids) {
    ids = new Set(freeWords(limit).map((word) => word.id));
    freeBankIds.set(String(limit), ids);
  }
  return ids;
}

/**
 * Whether a word may be practised.
 *
 * A parent's own words are always allowed, on any tier. They are not part of
 * the shipped collection, so the free collection cannot describe them, and
 * filtering them out meant a parent could add twenty words from their child's
 * reading book, see the confirmation, and never see them again.
 */
export const isAllowedWord = (
  id: string,
  allowed: ReadonlySet<string> | undefined,
) => !allowed || allowed.has(id) || isAddedWordId(id);
