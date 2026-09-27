import { readFileSync } from "node:fs";
import { SOURCE_ORDER } from "../lib/challenge/words.ts";
import { words } from "../lib/challenge/bank.ts";

/**
 * The word list, and the raw sources it came from.
 *
 * The words come from the generated bank, because that is what the app serves.
 * Merging the CSVs here as well built a second version of the same list, one
 * without the help and clue each word now carries, and a checker that reads a
 * different list from the one a child is given is checking nothing.
 */
export { words };

/** The source files themselves, for the checks that read them directly. */
export const sources = Object.fromEntries(
  SOURCE_ORDER.map((source) => [
    source,
    readFileSync(new URL(`../data/${source}.csv`, import.meta.url), "utf8"),
  ]),
);
