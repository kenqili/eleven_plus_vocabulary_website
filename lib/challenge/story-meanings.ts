import help from "../../data/learning/word-help.json" with { type: "json" };
import storyHelp from "../../data/learning/story-meanings.json" with { type: "json" };
import { typeAsksForTheWord, type QuestionType } from "./config.ts";
import type { Word } from "./words";
const meanings: Record<string, { meaning: string; clue: string }> = help;
const contexts: Record<
  string,
  Record<string, { meaning: string; syn?: string; ant?: string }>
> = storyHelp;
export function storyMeaning(
  word: Pick<Word, "id" | "definition">,
  storyId?: string,
): string {
  return (
    (storyId && contexts[storyId]?.[word.id]?.meaning) ||
    meanings[word.id]?.meaning ||
    word.definition
  );
}
/**
 * The word and cloze types ask for the word itself, and every example
 * sentence names it or an inflection of it, so no clue can be offered for
 * those without handing over the answer. Delegates to the shared rule so the
 * clue and the printed word can never disagree about which types reveal the
 * answer.
 */
export function typeAllowsClue(type: string) {
  return !typeAsksForTheWord(type as QuestionType);
}
export function wordClue(id: string, answer: string, type?: string): string {
  if (type !== undefined && !typeAllowsClue(type)) return "";
  const clue = meanings[id]?.clue ?? "";
  // A contextual clue should not repeat the exact correct option as a phrase.
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped && new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(clue)
    ? ""
    : clue;
}

export function storyRelated(word: Word, storyId: string) {
  const context = contexts[storyId]?.[word.id];
  return { syn: context?.syn ?? word.syn, ant: context?.ant ?? word.ant };
}
