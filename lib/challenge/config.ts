export const MASTERY_TARGET = 5;
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
