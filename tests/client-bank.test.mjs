/**
 * The browser's copy of the bank has to be able to build the same question the
 * server builds, from the same data, with the same code path.
 *
 * This matters because question generation is moving into the client. The moment
 * it does, the two implementations can drift, and the failure is invisible in the
 * worst way: a child is shown a question whose options do not contain its answer,
 * or whose distractors came from the wrong word, and nothing anywhere reports an
 * error. No existing test would notice, because none of them read this file.
 *
 * So the payload is checked against the server's own loader rather than against
 * a copy of it. `lib/challenge/bank.ts` is what the request path uses to turn the
 * shipped file into words and problems; if the client payload can produce the
 * same thing, it has everything the client needs and nothing has been quietly
 * dropped in the reshaping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  words as serverWords,
  problems as serverProblems,
  choicesForProblem,
  CHOICES_PER_PROBLEM,
} from "../lib/challenge/bank.ts";
import { QUESTION_TYPES } from "../lib/challenge/config.ts";
import { brotliCompressSync, constants } from "node:zlib";

import { testBank } from "./helpers/test-bank.mjs";
import { contentHash } from "../scripts/build-client-bank.mjs";

/**
 * The payload, built from tracked source.
 *
 * This opened `public/bank/bank-<tier>-<hash>.json` by name. That directory is
 * gitignored and the names are content hashes, so the suite failed on clean
 * checkouts and in CI — which runs no generation step — while passing on any
 * machine that had once built. `testBank` builds the identical payload from
 * `data/problem-bank.json` via the same function the generator calls.
 */
function payload(tier) {
  return testBank(tier);
}

/** The client's view of a problem, in the shape `choicesForProblem` expects. */
function asProblem(bank, record) {
  const [wordAt, typeAt, prompt, answer, distractors] = record;
  return {
    id: `${bank.types[typeAt]}:${bank.words[wordAt][0]}`,
    wordId: bank.words[wordAt][0],
    type: bank.types[typeAt],
    prompt,
    answer,
    // A definition question draws three of its pool; the rest are fixed. This is
    // the same split `lib/challenge/bank.ts` makes when it loads the file.
    choices: bank.types[typeAt] === "def" ? null : distractors,
    defPool: bank.types[typeAt] === "def" ? distractors : undefined,
  };
}

/** Deterministic stand-in for Math.random, so a shuffle can be compared. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test("every shipped problem is addressable and complete", () => {
  const bank = payload("full");
  assert.equal(bank.words.length, 2247, "the full tier must carry every word");
  assert.equal(bank.problems.length, 11015, "and every problem");
  assert.deepEqual(
    bank.types,
    [...QUESTION_TYPES].sort(
      (a, b) => bank.types.indexOf(a) - bank.types.indexOf(b),
    ),
    "the type list must cover every question type the app can ask",
  );
  for (const name of QUESTION_TYPES)
    assert.ok(
      bank.types.includes(name),
      `the client bank is missing type ${name}`,
    );

  const ids = new Set(bank.words.map((w) => w[0]));
  assert.equal(ids.size, bank.words.length, "word ids must be unique");
  for (const [wordAt, typeAt, prompt, answer, distractors] of bank.problems) {
    assert.ok(
      wordAt >= 0 && wordAt < bank.words.length,
      `a problem points at word ${wordAt}`,
    );
    assert.ok(bank.types[typeAt], `a problem points at type ${typeAt}`);
    assert.ok(prompt, "a problem has no prompt");
    assert.ok(answer, "a problem has no answer");
    assert.ok(
      Array.isArray(distractors) &&
        distractors.length >= CHOICES_PER_PROBLEM - 1,
    );
    // The answer is stored apart from the distractors on purpose, so this must
    // hold for every single problem or a question can be built that already
    // contains its own answer as a wrong option.
    assert.ok(
      !distractors.includes(answer),
      `the answer for ${bank.types[typeAt]}:${bank.words[wordAt][0]} is already among its distractors`,
    );
  }
});

test("the client's words match the server's loader, field for field", () => {
  const bank = payload("full");
  for (let at = 0; at < bank.words.length; at++) {
    const client = bank.words[at];
    const server = serverWords.find((w) => w.id === client[0]);
    assert.ok(
      server,
      `the client has a word the server does not: ${client[0]}`,
    );
    // The column order is fixed by the bank's meta, so compare positionally and
    // name each mismatch rather than reporting two arrays.
    const fields = ["word", "definition", "example", "syn", "ant"];
    fields.forEach((field, i) => {
      const expected =
        server[field] || (field === "help" ? server.definition : "");
      assert.equal(
        client[i] || "",
        expected || "",
        `${client[0]}: client ${field} does not match the server's`,
      );
    });
    assert.equal(
      client[5],
      serverWords.find((w) => w.id === client[0]).difficulty ?? client[5],
    );
    // The last two columns are the plain-language help and the contextual clue,
    // which the client needs to explain a word without asking the server.
    assert.ok(client[7], `${client[0]} shipped without the help a child reads`);
    assert.equal(
      client[7],
      server.help,
      `${client[0]}: the shipped help differs from the server's`,
    );
    assert.equal(
      client[8],
      server.clue,
      `${client[0]}: the shipped clue differs from the server's`,
    );
  }
});

test("a question rebuilt from the client payload matches the server's", () => {
  const bank = payload("full");
  // Sample rather than assert all 11,015, so a failure names a word a human can
  // look up. The stride is coprime with the problem count.
  const stride = 37;
  let checked = 0;
  for (let at = 0; at < bank.problems.length; at += stride) {
    const record = bank.problems[at];
    const clientProblem = asProblem(bank, record);
    const serverProblem = serverProblems.find((p) => p.id === clientProblem.id);
    assert.ok(serverProblem, `no server problem for ${clientProblem.id}`);
    assert.equal(
      clientProblem.prompt,
      serverProblem.prompt,
      `${clientProblem.id}: prompt differs`,
    );
    assert.equal(
      clientProblem.answer,
      serverProblem.answer,
      `${clientProblem.id}: answer differs`,
    );

    // Same seed on both sides: identical shuffle, so an identical option list.
    const mine = choicesForProblem(clientProblem, seeded(at + 1));
    const theirs = choicesForProblem(serverProblem, seeded(at + 1));
    assert.deepEqual(
      mine,
      theirs,
      `${clientProblem.id}: the client would show different options`,
    );
    assert.equal(
      mine.length,
      CHOICES_PER_PROBLEM,
      `${clientProblem.id}: wrong number of options`,
    );
    assert.ok(
      mine.includes(clientProblem.answer),
      `${clientProblem.id}: options omit the answer`,
    );
    assert.equal(
      new Set(mine).size,
      mine.length,
      `${clientProblem.id}: options contain a duplicate`,
    );
    checked++;
  }
  assert.ok(checked > 250, `expected a broad sample, only checked ${checked}`);
});

test("the free tier carries only free words, and all of them", () => {
  const full = payload("full");
  const free = payload("free");
  assert.equal(free.words.length, 224, "the free tier is 224 words");
  const freeIds = new Set(free.words.map((w) => w[0]));
  const fullWords = new Set(full.words.map((w) => w[0]));
  for (const id of freeIds)
    assert.ok(
      fullWords.has(id),
      `${id} is in the free tier but not the full one`,
    );
  // The limit is enforced by what is sent, so it has to actually be absent.
  assert.ok(freeIds.size < fullWords.size, "the free slice must be smaller");

  // Every free problem must resolve inside the free slice's own numbering, which
  // differs from the full slice's. A mismatch here is an out-of-range word index
  // in the browser and a crash on a child's first question.
  for (const [wordAt, typeAt, prompt, answer, distractors] of free.problems) {
    const word = free.words[wordAt];
    assert.ok(
      word,
      `a free problem points at word ${wordAt}, which the slice does not have`,
    );
    assert.ok(
      prompt && answer && distractors.length >= CHOICES_PER_PROBLEM - 1,
    );
    const problem = asProblem(free, [
      wordAt,
      typeAt,
      prompt,
      answer,
      distractors,
    ]);
    const options = choicesForProblem(problem, seeded(wordAt + 7));
    assert.ok(
      options.includes(answer),
      `free ${problem.id}: options omit the answer`,
    );
  }
  // And the slice must be a prefix of the shipped free order, which is how the
  // server decides what a lapsed account may use.
  const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
  assert.deepEqual(
    free.words.map((w) => w[0]),
    bank.freeOrder.slice(0, 224),
    "the free slice must be the first 224 words of the shipped free order",
  );
});

test("the payload is small enough to put in front of a child", () => {
  // Sized from the built payload rather than from files on disk: the bytes are
  // what matters, and the files do not exist on a clean checkout.
  const size = (tier) => {
    const raw = Buffer.from(JSON.stringify(payload(tier)));
    return brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  };
  const free = size("free");
  const full = size("full");
  // These are on the critical path of a child's first question, so they are
  // asserted rather than measured and forgotten. Raise them deliberately.
  assert.ok(
    free < 64 * 1024,
    `the free bank is ${(free / 1024).toFixed(0)} KB, over 64 KB`,
  );
  assert.ok(
    full < 400 * 1024,
    `the full bank is ${(full / 1024).toFixed(0)} KB, over 400 KB`,
  );
});

test("the generated files are content-hashed, so a stale one cannot be served", () => {
  // The naming rule lives in one exported function shared with the generator,
  // so this tests the rule rather than the files: on a clean checkout there
  // are no files, and a test that needs them can never run in CI.
  const a = contentHash(JSON.stringify(payload("full")));
  const b = contentHash(JSON.stringify(payload("free")));
  for (const [name, hash] of [
    ["full", a],
    ["free", b],
  ]) {
    assert.match(
      `bank-${name}-${hash}.json`,
      /^bank-(full|free)-[0-9a-f]{12}\.json$/,
      `the ${name} file must carry a content hash so it can be cached immutably`,
    );
  }
  // Deterministic: the same bytes hash the same way, so a rebuild that changes
  // nothing keeps its URLs and every client cache stays valid.
  assert.equal(contentHash(JSON.stringify(payload("full"))), a);
  assert.notEqual(a, b, "full and free payloads hash identically");
});
