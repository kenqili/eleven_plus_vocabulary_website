import { freeOrder, words, wordById } from "@/lib/challenge/bank";
import type { Word } from "@/lib/challenge/words";
import { configuredFreeWordLimit } from "./billing";

/** How many words the shipped collection holds. */
export const bankSize = () => words.length;

/** Prefix that marks a word a parent added, which is never part of the bank. */
export const isAddedWordId = (id: string) => id.startsWith("own:");

/**
 * Return the stable, easiest-band selection for signed-out and post-trial
 * access.
 *
 * Within each difficulty band the most common words come first, because a
 * child meets the free collection before they meet anything else. Sorting
 * alphabetically instead put six words beginning "ab" in a row and opened on
 * "ablest", which is a comparative form rather than a word anyone reads.
 */
export function freeWords(limit = configuredFreeWordLimit()): Word[] {
  // `freeOrder` is the shipped, difficulty-and-frequency order. The free
  // collection is its prefix - the same prefix the browser downloads - so the
  // server must not re-sort it at request time. Doing that used to give a
  // lapsed account one set of words in the client and a different set in the
  // endpoint, and it is also why a 224-word free collection contained only
  // nine five-letter game answers instead of the twenty the client shows.
  return freeOrder
    .slice(0, Math.min(limit, words.length))
    .map((id) => wordById(id))
    .filter((word): word is Word => Boolean(word));
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
