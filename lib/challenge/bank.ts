import flash1 from "@/data/flash_card_1.csv?raw";
import flash2 from "@/data/flash_card_2.csv?raw";
import blue from "@/data/blue_book.csv?raw";
import { mergeWordSources } from "./words";
import syn from "@/data/syn.csv?raw";
import ant from "@/data/ant.csv?raw";
import { createProblemBank } from "./problems";
export const words = mergeWordSources({
  flash_card_1: flash1,
  flash_card_2: flash2,
  blue_book: blue,
});
export const problems = createProblemBank(words, syn, ant);
export const problemById = new Map(
  problems.map((problem) => [problem.id, problem]),
);
