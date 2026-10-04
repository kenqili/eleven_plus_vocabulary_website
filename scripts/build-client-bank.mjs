/**
 * The client bank, built in memory from the source bank.
 *
 * This is the `build()` that used to live inline in
 * `scripts/generate-client-bank.mjs`, extracted so tests can build the exact
 * same payload without reading the generator's output files. Those files are
 * content-hashed (`bank-full-<hash>.json`), so any test that opens them by name
 * breaks on a clean checkout or in CI where the generator has not run — which
 * is exactly what happened to `tests/client-engine.test.mjs`. The tracked
 * source `data/problem-bank.json` is the stable input; the hashed files are
 * just a cache of it.
 *
 * Pure: parsed source bank in, client payload out. No filesystem reads.
 */
import { createHash } from "node:crypto";

/**
 * The content hash carried in generated filenames.
 *
 * One function shared with the generator, so the "cached immutably" naming
 * rule is tested rather than the files: `bank-<tier>-<12 hex>.json`, stable
 * for identical bytes so an unchanged rebuild keeps its URLs.
 */
export function contentHash(json) {
  return createHash("sha256").update(json).digest("hex").slice(0, 12);
}

export function buildClientBank(bank, ids) {
  const columns = bank.meta.wordColumns;
  const idColumn = columns.indexOf("id");
  const wordColumn = columns.indexOf("word");
  const shape = columns
    .filter((name) => name !== "id")
    .map((name) => columns.indexOf(name));
  const types = [...new Set(bank.problems.map((problem) => problem[1]))];
  const typeIndex = new Map(types.map((type, index) => [type, index]));
  const idOf = (row) => row[idColumn];
  const byRow = new Map();
  bank.words.forEach((row, at) => byRow.set(idOf(row), at));
  // Checked on every row, not just the sliced ones: if any row disagreed the
  // client would silently address the wrong word, so it throws instead.
  for (const row of bank.words) {
    if (row[idColumn] !== row[wordColumn])
      throw Error(
        `the id and the word differ for "${row[wordColumn]}", so the id column cannot be dropped`,
      );
  }
  const words = [];
  const index = new Map();
  for (const id of ids) {
    const row = bank.words[byRow.get(id)];
    index.set(id, words.length);
    words.push(shape.map((column) => row[column]));
  }
  const problems = [];
  for (const [wordId, type, prompt, answer, distractors] of bank.problems) {
    const at = index.get(wordId);
    if (at === undefined) continue;
    problems.push([at, typeIndex.get(type), prompt, answer, distractors]);
  }
  return {
    v: 1,
    choices: bank.meta.choicesPerProblem,
    types,
    words,
    problems,
  };
}

/** How many words a lapsed account may use. See lib/server/free-words.ts. */
export const FREE_WORD_COUNT = 224;

export function fullIds(bank) {
  const idColumn = bank.meta.wordColumns.indexOf("id");
  return bank.words.map((row) => row[idColumn]);
}

export function freeIds(bank) {
  const freeOrder = bank.freeOrder.slice(0, FREE_WORD_COUNT);
  if (
    freeOrder.length !== FREE_WORD_COUNT ||
    new Set(freeOrder).size !== FREE_WORD_COUNT
  )
    throw Error(
      `the shipped free order does not hold ${FREE_WORD_COUNT} distinct words; the free slice would be wrong`,
    );
  const idColumn = bank.meta.wordColumns.indexOf("id");
  const known = new Set(bank.words.map((row) => row[idColumn]));
  if (!freeOrder.every((id) => known.has(id)))
    throw Error("the free order names a word the bank does not contain");
  return freeOrder;
}
