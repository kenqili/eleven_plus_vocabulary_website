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
