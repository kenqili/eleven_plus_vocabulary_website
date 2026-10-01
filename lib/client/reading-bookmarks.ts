// Convenience bookmarks belong to this browser and account, not the credit ledger.
import { STORY_ID } from "../challenge/stories.ts";
export type Bookmark = {
  paragraph: number;
  fraction: number;
  updatedAt: number;
};
type Bookmarks = { level: number; stories: Record<string, Bookmark> };
const empty = (): Bookmarks => ({ level: 0, stories: {} });
const storyId = STORY_ID;
export function readBookmarks(scope: string): Bookmarks {
  try {
    const value = JSON.parse(
      localStorage.getItem(`minewords:reading:${scope}`) || "null",
    );
    if (!value || typeof value !== "object") return empty();
    const result = empty();
    if (Number.isInteger(value.level) && value.level >= 0 && value.level <= 5)
      result.level = value.level;
    for (const [id, raw] of Object.entries(value.stories || {})) {
      const bookmark = raw as Bookmark;
      if (
        storyId.test(id) &&
        bookmark &&
        Number.isInteger(bookmark.paragraph) &&
        bookmark.paragraph >= 0 &&
        Number.isFinite(bookmark.fraction) &&
        bookmark.fraction >= 0 &&
        bookmark.fraction <= 1 &&
        Number.isFinite(bookmark.updatedAt)
      )
        result.stories[id] = bookmark;
    }
    return result;
  } catch {
    return empty();
  }
}
export function saveReadingLevel(scope: string, level: number) {
  if (!Number.isInteger(level) || level < 0 || level > 5) return;
  const value = readBookmarks(scope);
  value.level = level;
  try {
    localStorage.setItem(`minewords:reading:${scope}`, JSON.stringify(value));
  } catch {
    /* Reading still works with storage disabled. */
  }
}
export function saveBookmark(scope: string, id: string, bookmark: Bookmark) {
  if (!storyId.test(id)) return;
  const value = readBookmarks(scope);
  value.stories[id] = bookmark;
  try {
    localStorage.setItem(`minewords:reading:${scope}`, JSON.stringify(value));
  } catch {
    /* Optional browser convenience. */
  }
}

/**
 * The option a child picked for a story they have not finished yet.
 *
 * Under its own key rather than as a field on the bookmark record above,
 * because the two have opposite lifetimes: a bookmark is kept until the story
 * is reread, and this is thrown away the moment the story is completed. Sharing
 * a key would put both through the same read-modify-write on every scroll
 * capture, so a fault in one would cost the other.
 *
 * This browser only, and it cannot be otherwise without changing what finishing
 * a story means. The one server call that takes an answer is `complete`, which
 * awards credits, so saving a draft server-side would pay for a story the
 * child walked away from - which is the thing this must not do. Losing the
 * draft to a cleared browser is the accepted cost; losing the child's sitting
 * would not be.
 */
const storyAnswerKey = (scope: string) => `minewords:story-answer:${scope}`;

function readStoryAnswers(scope: string): Record<string, number> {
  try {
    const value = JSON.parse(
      localStorage.getItem(storyAnswerKey(scope)) || "{}",
    );
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** What this browser has for this story, or nothing if there is no usable draft. */
export function readStoryAnswer(scope: string, id: string): number | null {
  if (!storyId.test(id)) return null;
  const answer = readStoryAnswers(scope)[id];
  // Three options, always: `validateStories` refuses a story with any other
  // number, so an index outside 0-2 is a stale key or a hand-edited value.
  return Number.isInteger(answer) && answer >= 0 && answer <= 2 ? answer : null;
}

/**
 * Remember the option, or forget it when `answer` is null.
 *
 * One function rather than a setter and a clearer, because clearing is what
 * finishing a story does and that is the only place a draft is ever discarded.
 */
export function saveStoryAnswer(
  scope: string,
  id: string,
  answer: number | null,
) {
  if (!storyId.test(id)) return;
  const value = readStoryAnswers(scope);
  if (answer === null) delete value[id];
  else value[id] = answer;
  try {
    localStorage.setItem(storyAnswerKey(scope), JSON.stringify(value));
  } catch {
    /* Optional browser convenience. */
  }
}
