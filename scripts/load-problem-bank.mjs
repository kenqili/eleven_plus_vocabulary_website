import { readFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import { createProblemBank } from "../lib/challenge/problems.ts";
export const synText = readFileSync(
  new URL("../data/syn.csv", import.meta.url),
  "utf8",
);
export const antText = readFileSync(
  new URL("../data/ant.csv", import.meta.url),
  "utf8",
);
export const problems = createProblemBank(words, synText, antText);
