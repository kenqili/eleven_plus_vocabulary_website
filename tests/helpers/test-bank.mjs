import { readFileSync } from "node:fs";
import {
  buildClientBank,
  freeIds,
  fullIds,
} from "../../scripts/build-client-bank.mjs";

/**
 * The client bank, built from source instead of read from disk.
 *
 * `public/bank/bank-<tier>-<hash>.json` is gitignored and content-hashed: the
 * name changes with the data and the files do not exist until
 * `npm run bank:client` runs. Every test that opened them by name failed on a
 * clean checkout and in CI — 19 failures at once — while passing on any machine
 * that had once built. The tracked source `data/problem-bank.json` is the
 * stable input, and `buildClientBank` is the exact function the generator
 * calls, so this is the same payload by construction rather than by filename.
 */
const source = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));

const cache = {};
export function testBank(tier = "full") {
  return (cache[tier] ??= buildClientBank(
    source,
    tier === "free" ? freeIds(source) : fullIds(source),
  ));
}
