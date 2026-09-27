import flash1 from "@/data/flash_card_1.csv?raw";
import flash2 from "@/data/flash_card_2.csv?raw";
import blue from "@/data/blue_book.csv?raw";
import vocabquest from "@/data/vocabquest.csv?raw";
import curriculum from "@/data/curriculum.csv?raw";
import { mergeWordSources } from "./words";
import syn from "@/data/syn.csv?raw";
import ant from "@/data/ant.csv?raw";
import { buildDistractorContext, createProblemBank } from "./problems";
import levels from "@/data/word-levels/levels.json";
export const words = mergeWordSources({
  flash_card_1: flash1,
  flash_card_2: flash2,
  blue_book: blue,
  vocabquest,
  curriculum,
});
/** The difficulty band the word list and the story library already publish. */
const levelOf = (id: string) =>
  (levels.words as Record<string, { difficulty: number }>)[id]?.difficulty ?? 3;
export const problems = createProblemBank(words, syn, ant, levelOf);

/**
 * The distractor context, built once. Definition questions pick their wrong
 * options from it at request time rather than scanning the whole bank, which
 * is why this is exported rather than rebuilt per question.
 */
export const distractorContext = buildDistractorContext(words, levelOf);
export const problemById = new Map(
  problems.map((problem) => [problem.id, problem]),
);
