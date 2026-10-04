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
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import {
  buildClientBank,
  contentHash,
  freeIds,
  fullIds,
} from "./build-client-bank.mjs";

const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
const OUT = resolve("public/bank");

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
 *
 * The shaping itself lives in `scripts/build-client-bank.mjs`, shared with the
 * test suite so tests build the same payload from source instead of reading
 * these hashed output files by name.
 */
function build(ids) {
  return buildClientBank(bank, ids);
}

mkdirSync(OUT, { recursive: true });
// Content-hashed names mean yesterday's files are dead weight; drop them so they
// cannot be deployed alongside today's.
for (const stale of readdirSync(OUT))
  rmSync(resolve(OUT, stale), { force: true });

const written = [];
for (const [name, payload] of [
  ["full", build(fullIds(bank))],
  ["free", build(freeIds(bank))],
]) {
  const json = JSON.stringify(payload);
  const hash = contentHash(json);
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
// The manifest is written twice, deliberately. The JSON beside the assets is
// what a browser can fetch without an account; the copy in data/ is the one the
// server imports, so /api/progress can name the right file in the same response
// that tells the child what they know. It is committed for the same reason
// data/problem-bank.json is: it is a build product whose freshness is checkable,
// and a generated TypeScript module would leave `tsc` broken on a clean clone
// that had not run the generator yet.
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  resolve("data/client-bank.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

for (const entry of written)
  console.log(
    `  client bank ${entry.name.padEnd(4)} ${String(entry.words).padStart(5)} words ` +
      `${String(entry.problems).padStart(6)} problems  ` +
      `${(entry.raw / 1024).toFixed(0).padStart(5)} KB raw  ` +
      `${(entry.compressed / 1024).toFixed(0).padStart(4)} KB brotli`,
  );
