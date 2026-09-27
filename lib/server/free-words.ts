import { freeOrder, levelOf, words, wordById } from "@/lib/challenge/bank";
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
  // The bank arrives already in this order: easiest band first, and most
  // frequent first within a band, with a word that has no frequency reading
  // last so it is only reached once the rest of the band is used up. It was
  // worked out here from the difficulty snapshot, which is a second data file
  // the request path no longer has to load.
  const buckets = [0, 1, 2, 3, 4, 5].map(() => [] as Word[]);
  for (const id of freeOrder) {
    const word = wordById(id);
    if (word) buckets[levelOf.get(id) ?? 3].push(word);
  }
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
