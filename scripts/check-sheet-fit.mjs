// Does the text actually fit the cell it is given?
//
// This is the check that matters for a printed sheet: a grid can be correct on
// paper and still print with meaning or example text cut off. It measures the
// real content from the bank against the real cell, worst case first, and
// reports the tightest margins for every combination the app offers.
//
// Run: node --experimental-strip-types scripts/check-sheet-fit.mjs
import { words } from "./load-word-bank.mjs";
import {
  CONTENT_MODES,
  DENSITIES,
  MIN_BODY_PT,
  cellText,
  canShow,
  fitSheet,
  textHeightMm,
} from "../lib/challenge/print-layout.ts";

let failures = 0;
const note = (message) => {
  failures += 1;
  console.log(`   FAIL ${message}`);
};

console.log(
  "grid  mode      pt    text budget   tightest entry in the bank         need   have  margin",
);
console.log("-".repeat(100));

for (const density of DENSITIES) {
  for (const content of CONTENT_MODES) {
    if (!canShow(density, content)) {
      console.log(
        `${density.id.padEnd(5)} ${content.padEnd(9)}    not offered, this grid cannot hold it`,
      );
      continue;
    }
    const sheet = fitSheet(density, content);
    if (!sheet) {
      note(`${density.id}/${content} is offered but has no solution`);
      continue;
    }
    const budget = { meaning: sheet.meaningChars, example: sheet.exampleChars };
    // Every word in the bank, worst case included, not a sample.
    let worst = { margin: Infinity, need: 0, word: null };
    for (const word of words) {
      const need = textHeightMm(
        cellText(word, content, budget),
        sheet.bodyPt,
        density.cellWidthMm,
      );
      const margin = density.cellHeightMm - need;
      if (margin < worst.margin) worst = { margin, need, word };
    }
    const ok = worst.margin >= 0;
    if (!ok) note(`${density.id}/${content} overflows by ${(-worst.margin).toFixed(1)}mm`);
    if (sheet.bodyPt < MIN_BODY_PT)
      note(`${density.id}/${content} is ${sheet.bodyPt}pt, below the ${MIN_BODY_PT}pt floor`);
    const label = `${worst.word.word} ${worst.word.definition}`.slice(0, 30);
    console.log(
      `${density.id.padEnd(5)} ${content.padEnd(9)} ${String(sheet.bodyPt).padStart(4)}pt  ` +
        `${String(budget.meaning).padStart(3)}+${String(budget.example).padEnd(4)}      ` +
        `${label.padEnd(30)} ` +
        `${worst.need.toFixed(1).padStart(5)} ${String(density.cellHeightMm).padStart(6)}  ` +
        `${(worst.margin >= 0 ? "+" : "") + worst.margin.toFixed(1)}mm`,
    );
  }
}

console.log("-".repeat(100));
console.log(
  failures
    ? `${failures} problem(s) found`
    : "every offered combination fits the longest entry in the bank",
);
process.exitCode = failures ? 1 : 0;
