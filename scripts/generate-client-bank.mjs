#!/usr/bin/env node
/**
 * Emit the question bank in the shape the browser needs, as static assets.
 *
 * The practice page used to ask the server for one question at a time. Moving
 * question generation into the client means it no longer asks, which means the
 * browser needs the data that generation runs on: every word, and every problem
 * with its distractors.
 *
 * Two things make this worth doing rather than shipping the file as it stands.
 *
 * **It is much smaller than the file it comes from.** The bank stores each word's
 * id beside the word itself, and for all 2,247 of them those are the same
 * string, so the column is dropped and problems reference words by index. The
 * difficulty table, the free order and the build metadata are not client
 * concerns. That takes 2.9 MB of JSON down to about a third of it, and about a
 * third again once brotli has it, which Cloudflare serves automatically.
 *
 * **It is split by entitlement.** An account that may use the whole collection
 * gets all of it; a lapsed one gets the free collection, which is a fraction of
 * the size. Sending only the words an account may use also means the limit is
 * enforced by what is sent rather than by something the client could decline to
 * honour - which matters here precisely because the answers are in this file
 * either way.
 *
 * Output is content-hashed, so the URL changes when the data does and the file
 * can be cached immutably. The manifest is what /api/progress hands over, so the
 * naming scheme is decided in one place. The sizes are printed because this
 * download is now on the critical path of a child's first question.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
const OUT = resolve("public/bank");

/** How many words a lapsed account may use. See lib/server/free-words.ts. */
const FREE_WORD_COUNT = 224;

const types = [...new Set(bank.problems.map((problem) => problem[1]))];
const typeIndex = new Map(types.map((type, index) => [type, index]));

/**
 * The word columns, minus the id.
 *
 * Order is fixed by `meta.wordColumns` in the bank. The id is dropped because it
 * equals the word for every row in the collection, which was checked rather than
 * assumed; if a row ever disagreed the client would silently address the wrong
 * word, so the check below throws instead.
 */
const columns = bank.meta.wordColumns;
const idColumn = columns.indexOf("id");
const wordColumn = columns.indexOf("word");
const shape = columns
  .filter((name) => name !== "id")
  .map((name) => columns.indexOf(name));

const shapedWords = bank.words.map((row) => {
  if (row[idColumn] !== row[wordColumn])
    throw Error(
      `the id and the word differ for "${row[wordColumn]}", so the id column cannot be dropped`,
    );
  return shape.map((column) => row[column]);
});

const freeOrder = bank.freeOrder.slice(0, FREE_WORD_COUNT);
if (
  freeOrder.length !== FREE_WORD_COUNT ||
  new Set(freeOrder).size !== FREE_WORD_COUNT
)
  throw Error(
    `the shipped free order does not hold ${FREE_WORD_COUNT} distinct words; the free slice would be wrong`,
  );
const idOf = (row) => row[idColumn];
const allIds = bank.words.map(idOf);
if (!freeOrder.every((id) => bank.words.some((row) => idOf(row) === id)))
  throw Error("the free order names a word the bank does not contain");

/**
 * Build one slice, in the order the ids are given.
 *
 * Order is not cosmetic. A lapsed child has met none of the free words, so every
 * one of them ties on "seen", and whichever the ordering falls back to is what
 * they are shown first. The shipped free order is easiest-band-first and
 * most-frequent-first within a band, so the free slice follows it: a child who
 * has just signed up meets "abandon" rather than "zealous".
 *
 * Words are addressed by index within the slice, so the free slice's problems
 * point at its own numbering rather than at the full collection's.
 */
function build(ids) {
  const byId = new Map();
  bank.words.forEach((row, at) => byId.set(idOf(row), at));
  const words = [];
  const index = new Map();
  for (const id of ids) {
    index.set(id, words.length);
    words.push(shapedWords[byId.get(id)]);
  }
  const problems = [];
  for (const [wordId, type, prompt, answer, distractors] of bank.problems) {
    const at = index.get(wordId);
    if (at === undefined) continue;
    // The distractors ship separately from the answer, which is what stops a
    // question being built with its own answer already in the option list. The
    // client recombines the two with the same pure `choicesForProblem` the
    // server uses, so a question looks identical either side.
    problems.push([at, typeIndex.get(type), prompt, answer, distractors]);
  }
  return { v: 1, choices: bank.meta.choicesPerProblem, types, words, problems };
}

mkdirSync(OUT, { recursive: true });
// Content-hashed names mean yesterday's files are dead weight; drop them so they
// cannot be deployed alongside today's.
for (const stale of readdirSync(OUT))
  rmSync(resolve(OUT, stale), { force: true });

const written = [];
for (const [name, payload] of [
  ["full", build(allIds)],
  ["free", build(freeOrder)],
]) {
  const json = JSON.stringify(payload);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 12);
  const file = `bank-${name}-${hash}.json`;
  writeFileSync(resolve(OUT, file), json);
  const raw = Buffer.byteLength(json);
  written.push({
    name,
    file,
    words: payload.words.length,
    problems: payload.problems.length,
    raw,
    compressed: brotliCompressSync(Buffer.from(json), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  });
}

const manifest = Object.fromEntries(
  written.map((entry) => [
    entry.name,
    {
      url: `/bank/${entry.file}`,
      words: entry.words,
      problems: entry.problems,
    },
  ]),
);
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const entry of written)
  console.log(
    `  client bank ${entry.name.padEnd(4)} ${String(entry.words).padStart(5)} words ` +
      `${String(entry.problems).padStart(6)} problems  ` +
      `${(entry.raw / 1024).toFixed(0).padStart(5)} KB raw  ` +
      `${(entry.compressed / 1024).toFixed(0).padStart(4)} KB brotli`,
  );
