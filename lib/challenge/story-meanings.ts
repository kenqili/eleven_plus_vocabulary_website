import help from "../../data/learning/word-help.json" with { type: "json" };
import storyHelp from "../../data/learning/story-meanings.json" with { type: "json" };
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
export function wordClue(id: string, answer: string): string {
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
