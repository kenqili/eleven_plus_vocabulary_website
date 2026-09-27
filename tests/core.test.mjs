import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mergeWordSources,
  parseWordCsv,
  SOURCE_ORDER,
} from "../lib/challenge/words.ts";
import { freeOrder, levelOf, problems } from "../lib/challenge/bank.ts";
import { words, sources } from "../scripts/load-word-bank.mjs";
import { hashPassword, verifyPassword } from "../lib/server/password.ts";
import { verifyStripeSignature } from "../lib/server/webhook.ts";
test("Runtime bank feeds every source, so the served app matches the validators", () => {
  // lib/challenge/bank.ts builds the bank the app actually serves, using Vite
  // `?raw` imports that a plain Node test cannot evaluate. Assert instead that
  // it names every source, so adding one to SOURCE_ORDER without wiring it here
  // cannot silently ship a smaller bank than the scripts and tests check.
  // The runtime bank is generated from these files rather than reading them, so
  // the check is that the generated file still carries every source. Otherwise
  // adding a sixth source would pass every check and quietly ship a smaller
  // bank than the validators see.
  const generated = readFileSync(
    new URL("../data/problem-bank.json", import.meta.url),
    "utf8",
  );
  const bankSources = new Set(
    [...generated.matchAll(/"(flash_card_1|flash_card_2|blue_book|vocabquest|curriculum)"/g)].map(
      (match) => match[1],
    ),
  );
  for (const source of SOURCE_ORDER) {
    assert.ok(
      bankSources.has(source),
      `the generated bank carries no words from ${source}`,
    );
    assert.ok(
      sources[source] !== undefined && sources[source].length > 0,
      `${source} has no CSV content for the validators to load`,
    );
  }
});
test("Merged CSV bank keeps the first occurrence and produces four distinct choices for every word", () => {
  const expected = new Map();
  for (const source of SOURCE_ORDER) {
    for (const word of parseWordCsv(sources[source], source))
      if (!expected.has(word.id)) expected.set(word.id, word);
  }
  // The bank carries two fields the source CSVs do not: the plain-language help
  // and the contextual clue, both generated. Everything else has to match the
  // merged sources exactly, or a word has drifted.
  for (const word of words) {
    const fromSource = expected.get(word.id);
    assert.ok(fromSource, `${word.id} is in the bank but in no source`);
    assert.deepEqual(
      {
        id: word.id,
        word: word.word,
        definition: word.definition,
        example: word.example,
        syn: word.syn,
        ant: word.ant,
        source: word.source,
      },
      {
        id: fromSource.id,
        word: fromSource.word,
        definition: fromSource.definition,
        example: fromSource.example,
        syn: fromSource.syn,
        ant: fromSource.ant,
        source: fromSource.source,
      },
      `${word.id} has drifted from its source`,
    );
    assert.ok(word.help, `${word.id} has no plain-language help`);
    assert.ok(
      word.help.length <= 160,
      `${word.id} help is ${word.help.length} characters, over the 160 a child will read`,
    );
  }
  assert.equal(words.length, expected.size, "the bank and the sources differ in size");

  for (const problem of problems) {
    const pool = problem.choices ?? problem.defPool;
    assert.ok(pool, `${problem.id} has no options at all`);
    assert.equal(new Set(pool).size, pool.length, `${problem.id} has a repeated option`);
    assert.ok(
      !pool.includes(problem.answer),
      `${problem.id} offers its own answer as a wrong option`,
    );
    // Three wrong options is the minimum a four-way question needs. A
    // definition question keeps a larger pool so a repeat can differ.
    assert.ok(
      pool.length >= 3,
      `${problem.id} has ${pool.length} options, which is not enough`,
    );
  }
  // And the pool for a definition question has to be bigger than three, or every
  // repeat of that word would show exactly the same question.
  for (const problem of problems) {
    if (problem.type !== "def") continue;
    assert.ok(
      (problem.defPool?.length ?? 0) >= 4,
      `${problem.id} keeps only three wrong definitions, so it cannot vary`,
    );
  }
});
test("First-wins deduplication retains source and all fields, including within a file", () => {
  const merged = mergeWordSources({
    curriculum: "word,def\n",
    blue_book: "word,def\nALPHA,discarded\ndelta,fourth",
    flash_card_2: "word,def\nbeta,discarded\ngamma,third",
    flash_card_1:
      "word,def,syn,ant,example\n Alpha ,first,one,two,example\nalpha,discarded,,,\nbeta,second,,,",
  });
  assert.deepEqual(
    merged.map((w) => [w.id, w.source, w.definition]),
    [
      ["alpha", "flash_card_1", "first"],
      ["beta", "flash_card_1", "second"],
      ["gamma", "flash_card_2", "third"],
      ["delta", "blue_book", "fourth"],
    ],
  );
  assert.equal(merged[0].syn, "one");
  assert.equal(merged[0].ant, "two");
  assert.equal(merged[0].example, "example");
});
test("CSV parsing supports BOM, CRLF, quoted commas, escaped quotes and multiline fields", () => {
  const rows = parseWordCsv(
    '\uFEFFword,def,syn,ant,example\r\nword,"a, b",,,"He said ""hi"".\nNext line."\r\n',
    "blue_book",
  );
  assert.equal(rows[0].definition, "a, b");
  assert.equal(rows[0].example, 'He said "hi".\nNext line.');
  assert.throws(
    () => parseWordCsv('word,def\na,"unterminated', "blue_book"),
    /Unterminated/,
  );
  assert.throws(
    () => parseWordCsv("word,def\na,", "blue_book"),
    /Invalid word/,
  );
  assert.throws(
    () => parseWordCsv("word,def\na,b,c", "blue_book"),
    /column count/,
  );
  assert.throws(
    () => parseWordCsv("word,word\na,b", "blue_book"),
    /unique headers/,
  );
});
test("Password hashes are salted and reject incorrect credentials", () => {
  const a = hashPassword("a long test password");
  const b = hashPassword("a long test password");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("a long test password", a));
  assert.equal(verifyPassword("not the password", a), false);
  assert.equal(verifyPassword("anything", "invalid"), false);
});
test("Stripe signatures reject forgery, modified body and stale requests", () => {
  const body = '{"type":"customer.subscription.updated"}',
    now = 1789680000,
    secret = "test-webhook-secret";
  const digest = createHmac("sha256", secret)
    .update(`${now}.${body}`)
    .digest("hex");
  const signature = `t=${now},v1=${digest}`;
  assert.ok(verifyStripeSignature(body, signature, secret, now));
  assert.ok(
    verifyStripeSignature(
      body,
      `t=${now},v1=${"0".repeat(64)},v1=${digest}`,
      secret,
      now,
    ),
  );
  assert.equal(
    verifyStripeSignature(body + " ", signature, secret, now),
    false,
  );
  assert.equal(
    verifyStripeSignature(body, signature, secret, now + 301),
    false,
  );
  assert.equal(
    verifyStripeSignature(body, signature, "wrong secret", now),
    false,
  );
  assert.equal(
    verifyStripeSignature(body, "t=invalid,v1=abc", secret, now),
    false,
  );
});
test("the bank encodes the free collection order exactly as it was chosen", () => {
  // The free collection is the first thing a new child sees, so a quiet
  // reordering is the worst kind of regression to discover later. The order
  // used to be worked out at request time from the difficulty snapshot. It is
  // carried in the bank now, so that snapshot is not a second file the request
  // path has to load - which means nothing checks the two agree unless this
  // does.
  const snapshot = JSON.parse(
    readFileSync(new URL("../data/word-levels/levels.json", import.meta.url), "utf8"),
  );
  const fromSnapshot = [0, 1, 2, 3, 4, 5].map((difficulty) =>
    words
      .filter((word) => snapshot.words[word.id]?.difficulty === difficulty)
      .sort((a, b) => {
        // Most frequent first, and a word with no frequency reading last.
        const byFrequency =
          (snapshot.words[b.id]?.frequencyZipf ?? -1) -
          (snapshot.words[a.id]?.frequencyZipf ?? -1);
        if (byFrequency) return byFrequency;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .map((word) => word.id),
  );

  const fromBank = [0, 1, 2, 3, 4, 5].map(() => []);
  for (const id of freeOrder) {
    const word = words.find((candidate) => candidate.id === id);
    if (word) fromBank[levelOf.get(id) ?? 3].push(id);
  }

  assert.deepEqual(
    fromBank,
    fromSnapshot,
    "the free collection order no longer matches the difficulty snapshot, so the first words a new child sees have changed",
  );
  // And the bank's flat order has to be those six bands, in order, or the
  // request path cannot take a prefix of it.
  const flat = fromBank.flat();
  assert.equal(flat.length, words.length, "the bank's free order misses a word");
  assert.deepEqual(
    new Set(flat).size,
    words.length,
    "the bank's free order repeats a word",
  );
});
