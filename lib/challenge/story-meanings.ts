import { typeAsksForTheWord, type QuestionType } from "./config.ts";
import storyHelp from "../../data/learning/story-meanings.json" with { type: "json" };
import type { Word } from "./words";

/**
 * The plain-language wording a child reads for a word.
 *
 * Two sources, in order. A story that has been reviewed has its own wording for
 * that story, because the same word can mean something different in a story about
 * a siege than it does in general, and a child reading that story deserves the
 * one that fits. Otherwise the word's own help, which is a rewrite of its
 * definition in plainer words.
 *
 * Both used to be a separate 420 KB file loaded to answer one question. The
 * per-word help is now carried on the word itself, so answering a question reads
 * nothing but the bank. The story-specific wording stays a file: it is a
 * different thing, keyed by story rather than by word, and there are only 25
 * stories that have one.
 *
 * Falling back to the definition rather than showing nothing is deliberate. A
 * child who is told no explanation exists learns that the app is broken, which
 * is worse than reading a slightly more formal version of the same fact.
 */
const contexts: Record<
  string,
  Record<string, { meaning: string; syn?: string; ant?: string }>
> = storyHelp;

export function storyMeaning(
  word: Pick<Word, "id" | "definition" | "help">,
  storyId?: string,
): string {
  return (
    (storyId && contexts[storyId]?.[word.id]?.meaning) ||
    word.help ||
    word.definition
  );
}

/**
 * Whether this question type can offer a clue at all.
 *
 * The word and cloze types ask for the word itself, and every example sentence
 * names it or an inflection of it, so any clue would hand over the answer.
 * Delegated to the shared rule so the clue and the printed word can never
 * disagree about which types reveal the answer.
 */
export function typeAllowsClue(type: string) {
  return !typeAsksForTheWord(type as QuestionType);
}

export function wordClue(
  word: Pick<Word, "id" | "clue" | "definition">,
  answer: string,
  type?: string,
): string {
  if (type !== undefined && !typeAllowsClue(type)) return "";
  const clue = word.clue ?? "";
  if (!clue) return "";
  // A contextual clue must not repeat the exact correct option, or it hands the
  // answer over as help.
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped && new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(clue)
    ? ""
    : clue;
}

/** Related words in the words of the story, where it has its own. */
export function storyRelated(word: Word, storyId: string) {
  const context = contexts[storyId]?.[word.id];
  return { syn: context?.syn ?? word.syn, ant: context?.ant ?? word.ant };
}
