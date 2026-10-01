/**
 * A word a parent typed and did not add yet.
 *
 * The form is only persisted when it is submitted, and the page above it is one
 * link back to the word list, so without this a definition copied out of a
 * reading book is gone the moment that link is followed.
 *
 * Deliberately not scoped to the account, unlike the reading bookmarks beside
 * it. Nothing on this page knows who is signed in - the session cookie is
 * HttpOnly and the settings snapshot carries no id - so the only honest key is
 * one per browser. On a laptop the family shares that means a second parent can
 * see the first one's half-typed word, which is a small thing to expose next to
 * changing an endpoint, and it lasts only until the word is added.
 */

export type WordDraft = { word: string; definition: string; example: string };

/** A fresh object every call, so a cleared form is never the same reference. */
export const emptyWordDraft = (): WordDraft => ({
  word: "",
  definition: "",
  example: "",
});

const key = "minewords:parent-word-draft";

/** The inputs' own `maxLength`, so a stored value can never come back too long. */
const limits: Record<keyof WordDraft, number> = {
  word: 60,
  definition: 200,
  example: 240,
};

/** This browser's half-typed word, or three empty fields if there is none. */
export function readWordDraft(): WordDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || typeof value !== "object") return emptyWordDraft();
    const field = (name: keyof WordDraft) =>
      typeof value[name] === "string" ? value[name].slice(0, limits[name]) : "";
    return {
      word: field("word"),
      definition: field("definition"),
      example: field("example"),
    };
  } catch {
    return emptyWordDraft();
  }
}

/**
 * Mirror the form as it is typed.
 *
 * An entirely empty draft is removed rather than stored, so a form the parent
 * has finished with leaves nothing behind for their next visit to restore.
 */
export function saveWordDraft(draft: WordDraft) {
  try {
    if (!draft.word && !draft.definition && !draft.example)
      localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* The form still works with storage disabled. */
  }
}
