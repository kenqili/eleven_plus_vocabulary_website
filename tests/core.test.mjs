import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  mergeWordSources,
  parseWordCsv,
  choicesFor,
} from "../lib/challenge/words.ts";
import { words, sources } from "../scripts/load-word-bank.mjs";
import { hashPassword, verifyPassword } from "../lib/server/password.ts";
import { verifyStripeSignature } from "../lib/server/webhook.ts";
test("Merged CSV bank keeps the first occurrence and produces four distinct choices for every word", () => {
  const expected = new Map();
  for (const source of ["flash_card_1", "flash_card_2", "blue_book"]) {
    for (const word of parseWordCsv(sources[source], source))
      if (!expected.has(word.id)) expected.set(word.id, word);
  }
  assert.deepEqual(words, [...expected.values()]);
  for (const word of words) {
    const choices = choicesFor(word, words);
    assert.equal(choices.length, 4);
    assert.equal(new Set(choices).size, 4);
    assert.equal(choices.filter((x) => x === word.definition).length, 1);
  }
});
test("First-wins deduplication retains source and all fields, including within a file", () => {
  const merged = mergeWordSources({
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
