import { parseCsv, type Word } from "./words.ts";
import type { QuestionType } from "./config.ts";
export type Problem = {
  id: string;
  wordId: string;
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  answer: string;
};

export function parseProblemCsv(
  text: string,
  expectedType: "syn" | "ant",
  words: Word[],
): Problem[] {
  const [header, ...rows] = parseCsv(text);
  const required = ["problem", "options", "answer", "syn/ant", "word"];
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((key) => !header.includes(key))
  )
    throw Error(`${expectedType}.csv has invalid headers.`);
  const wordIds = new Set(words.map((word) => word.id)),
    seen = new Set<string>();
  return rows.map((row, index) => {
    const cell = (name: string) => row[header.indexOf(name)];
    const wordId = cell("word")?.normalize("NFKC").toLowerCase();
    if (
      row.length !== header.length ||
      !wordIds.has(wordId) ||
      seen.has(wordId) ||
      cell("syn/ant") !== expectedType ||
      !cell("problem")
    )
      throw Error(
        `${expectedType}.csv: invalid/duplicate problem at record ${index + 2}.`,
      );
    let choices: unknown;
    try {
      choices = JSON.parse(cell("options"));
    } catch {
      throw Error(
        `${expectedType}.csv: options must be a JSON array at record ${index + 2}.`,
      );
    }
    const answer = cell("answer");
    if (
      !Array.isArray(choices) ||
      choices.length !== 4 ||
      choices.some((x) => typeof x !== "string" || !x.trim()) ||
      new Set(choices.map((x) => x.trim().toLowerCase())).size !== 4 ||
      choices.filter((x) => x === answer).length !== 1
    )
      throw Error(
        `${expectedType}.csv: four distinct options and exactly one matching answer required at record ${index + 2}.`,
      );
    seen.add(wordId);
    return {
      id: `${expectedType}:${wordId}`,
      wordId,
      type: expectedType,
      prompt: cell("problem"),
      choices: choices as string[],
      answer,
    };
  });
}

export function createProblemBank(
  words: Word[],
  syn: string,
  ant: string,
): Problem[] {
  return [
    ...words.map((word) => ({
      id: `def:${word.id}`,
      wordId: word.id,
      type: "def" as const,
      prompt: `Choose the definition for '${word.word}'.`,
      choices: null,
      answer: word.definition,
    })),
    ...parseProblemCsv(syn, "syn", words),
    ...parseProblemCsv(ant, "ant", words),
  ];
}
