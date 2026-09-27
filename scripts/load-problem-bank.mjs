import { readFileSync } from "node:fs";
import { words, problems, levelOf } from "../lib/challenge/bank.ts";

/**
 * The question bank, for the scripts and tests that check it.
 *
 * This used to rebuild the bank from the word list and the two question CSVs,
 * on the reasoning that a checker has to build the questions exactly as the app
 * does or it is checking a different set. That reasoning was right, and keeping
 * it that way cost about 1.4 seconds on every test run and left the checks
 * running against a second construction of the same data.
 *
 * The app now serves a bank generated at build time, so this reads that same
 * file. A checker and the app now share one source by construction rather than
 * by agreeing to be careful, which is the only version of that guarantee that
 * survives a year of edits.
 */
export { words, problems, levelOf };

/** The raw question CSVs, for the checks that read the files themselves. */
export const synText = readFileSync(
  new URL("../data/syn.csv", import.meta.url),
  "utf8",
);
export const antText = readFileSync(
  new URL("../data/ant.csv", import.meta.url),
  "utf8",
);
