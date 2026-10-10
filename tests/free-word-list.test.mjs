// The free starter list: one source of truth for the page and the PDF.
//
// `data/free-word-list.json` is what the free words page renders and what the
// downloadable PDF is printed from. If the two ever named different hundred
// words, a parent comparing them would catch the site in a lie - so the shape,
// the quotas, the bank membership and the PDF's contents are all asserted here.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { words } from "../scripts/load-word-bank.mjs";

const QUOTA = { 0: 10, 1: 18, 2: 18, 3: 18, 4: 18, 5: 18 };
const list = JSON.parse(readFileSync("data/free-word-list.json", "utf8"));

test("the starter list is 100 words in the right per-level quotas", () => {
  assert.equal(list.version, 1);
  assert.equal(list.count, 100);
  assert.deepEqual(
    list.groups.map((group) => group.band),
    [0, 1, 2, 3, 4, 5],
  );
  for (const group of list.groups) {
    assert.equal(
      group.words.length,
      QUOTA[group.band],
      `band ${group.band} holds ${group.words.length} words, not ${QUOTA[group.band]}`,
    );
  }
});

test("every listed word is a bank word with its own definition", () => {
  const byWord = new Map(words.map((word) => [word.word, word]));
  const seen = new Set();
  for (const group of list.groups) {
    for (const entry of group.words) {
      assert.ok(
        entry.word && entry.definition,
        "a starter entry is missing its word or its meaning",
      );
      const bank = byWord.get(entry.word);
      assert.ok(bank, `"${entry.word}" is not in the word bank`);
      assert.equal(
        entry.definition,
        bank.definition,
        `"${entry.word}" carries a meaning the bank does not have`,
      );
      assert.ok(!seen.has(entry.word), `"${entry.word}" is listed twice`);
      seen.add(entry.word);
    }
  }
  assert.equal(seen.size, 100);
});

test("the downloadable PDF holds the same hundred words", () => {
  const file = "public/free-11-plus-vocabulary-words.pdf";
  assert.ok(existsSync(file), "the starter PDF has not been generated");
  const pdf = readFileSync(file);
  assert.ok(
    pdf.subarray(0, 5).toString() === "%PDF-",
    "the starter download is not a PDF",
  );
  // Generated uncompressed, so the words are greppable text rather than
  // streams that only a reader can see.
  const text = pdf.toString("latin1");
  const missing = [];
  for (const group of list.groups) {
    for (const entry of group.words) {
      if (!text.includes(entry.word)) missing.push(entry.word);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `the PDF is missing words the page lists: ${missing.slice(0, 5).join(", ")}`,
  );
  assert.ok(
    text.includes("page 2"),
    "the PDF fits on one page, so a section or the footer went missing",
  );
});
