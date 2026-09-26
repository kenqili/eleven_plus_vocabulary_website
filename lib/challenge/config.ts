import { DIFFICULTY_LEVELS, type Difficulty } from "./difficulty.ts";

export const QUESTION_TYPES = ["def", "syn", "ant"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const TYPE_LABELS: Record<QuestionType, string> = {
  def: "Definition",
  syn: "Synonym",
  ant: "Antonym",
};
export const TYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  def: "Which definition matches this word?",
  syn: "Choose the word or phrase with the closest meaning.",
  ant: "Choose the word or phrase with the opposite meaning.",
};
export function parseQuestionTypes(value: unknown): QuestionType[] {
  if (value === undefined || value === null) return [...QUESTION_TYPES];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((type) => !QUESTION_TYPES.includes(type))
  )
    throw Error("Select at least one valid practice type: def, syn or ant.");
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
