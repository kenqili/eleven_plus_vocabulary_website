// The free starter list, as data rather than as code.
//
// 100 words across the six levels with plain meanings. Both the free word
// list page and the downloadable PDF read this file, so the two can never
// disagree about which hundred words are free. Regenerate with:
//   node scripts/generate-free-word-list.mjs
// then regenerate the PDF with:
//   python3 scripts/generate-free-word-list-pdf.py
import { readFileSync, writeFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";

const levels = JSON.parse(
  readFileSync(new URL("../data/word-levels/levels.json", import.meta.url), "utf8"),
).words;

const QUOTA = { 0: 10, 1: 18, 2: 18, 3: 18, 4: 18, 5: 18 };

const groups = [0, 1, 2, 3, 4, 5].map((band) => {
  const inBand = words
    .filter((word) => levels[word.id]?.difficulty === band)
    .sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  const step = Math.max(1, Math.floor(inBand.length / QUOTA[band]));
  const picked = inBand
    .filter((_, index) => index % step === 0)
    .slice(0, QUOTA[band]);
  if (picked.length !== QUOTA[band])
    throw new Error(`band ${band}: picked ${picked.length}, wanted ${QUOTA[band]}`);
  return {
    band,
    words: picked.map((word) => ({
      word: word.word,
      definition: word.definition,
    })),
  };
});

const out = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  count: groups.reduce((sum, group) => sum + group.words.length, 0),
  groups,
};
writeFileSync(
  new URL("../data/free-word-list.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`free word list: ${out.count} words -> data/free-word-list.json`);
