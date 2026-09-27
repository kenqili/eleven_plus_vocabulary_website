import { readFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import { createProblemBank } from "../lib/challenge/problems.ts";
import levels from "../data/word-levels/levels.json" with { type: "json" };

export const synText = readFileSync(
  new URL("../data/syn.csv", import.meta.url),
  "utf8",
);
export const antText = readFileSync(
  new URL("../data/ant.csv", import.meta.url),
  "utf8",
);

/**
 * The same band lookup the app uses. Anything that measures or checks the
 * generated questions has to build the bank exactly as the app does, or it is
 * measuring a different set of questions from the ones a child is given.
 */
export const levelOf = (id) => levels.words?.[id]?.difficulty ?? 3;

export const problems = createProblemBank(words, synText, antText, levelOf);
