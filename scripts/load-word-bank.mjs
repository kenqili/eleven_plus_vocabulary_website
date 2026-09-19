import { readFileSync } from "node:fs";
import { SOURCE_ORDER, mergeWordSources } from "../lib/challenge/words.ts";
export const sources = Object.fromEntries(
  SOURCE_ORDER.map((source) => [
    source,
    readFileSync(new URL(`../data/${source}.csv`, import.meta.url), "utf8"),
  ]),
);
export const words = mergeWordSources(sources);
