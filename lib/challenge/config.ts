import { DIFFICULTY_LEVELS, type Difficulty } from "./difficulty.ts";

export const QUESTION_TYPES = ["def", "syn", "ant", "word", "cloze"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const TYPE_LABELS: Record<QuestionType, string> = {
  def: "Definition",
  syn: "Synonym",
  ant: "Antonym",
  word: "Word",
  cloze: "Sentence",
};
export const TYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  def: "Which definition matches this word?",
  syn: "Choose the word or phrase with the closest meaning.",
  ant: "Choose the word or phrase with the opposite meaning.",
  word: "Which word matches this meaning?",
  cloze: "Which word is missing from the sentence?",
};
/** Short button captions for the practice type picker. */
/**
 * One name per type, used everywhere: the picker, the card and the feedback.
 * They used to differ between the three, so the same question was called a
 * meaning, a definition and a Meanings in one sitting.
 */
export const TYPE_BUTTONS: Record<QuestionType, string> = {
  def: "Meanings",
  syn: "Similar words",
  ant: "Opposite words",
  word: "Name the word",
  cloze: "Fill the gap",
};
/**
 * One line of background under each picker label, saying which way round the
 * question runs. "Name the word" and "Fill the gap" are the two that work in
 * the opposite direction from the rest, and a label alone does not say so.
 */
export const TYPE_SUMMARIES: Record<QuestionType, string> = {
  def: "See the word, pick its meaning",
  syn: "See the word, pick a close match",
  ant: "See the word, pick its opposite",
  word: "See the meaning, name the word",
  cloze: "Spot the word in a real sentence",
};
/**
 * The word and cloze types ask the child to produce the word itself, so the
 * answer is the whole point of the question. The card must not print the word
 * or play it, and no clue can be offered either, because every example
 * sentence names the word it is blanking.
 */
export function typeAsksForTheWord(type: QuestionType): boolean {
  return type === "word" || type === "cloze";
}
export function parseQuestionTypes(value: unknown): QuestionType[] {
  if (value === undefined || value === null) return [...QUESTION_TYPES];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((type) => !QUESTION_TYPES.includes(type))
  )
    throw Error(
      "Select at least one valid practice type: def, syn, ant, word or cloze.",
    );
  return QUESTION_TYPES.filter((type) => value.includes(type));
}
/** null practises every level; "all" is what the client sends for mixed practice. */
export function parsePracticeLevel(value: unknown): Difficulty | null {
  if (value === undefined || value === null || value === "" || value === "all")
    return null;
  if (typeof value !== "number" && typeof value !== "string")
    throw Error("Choose a valid practice level: all, 0 to 5.");
  const level = Number(value);
  if (!Number.isInteger(level) || !(level in DIFFICULTY_LEVELS))
    throw Error("Choose a valid practice level: all, 0 to 5.");
  return level as Difficulty;
}
