import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { words } from "./load-word-bank.mjs";
import { problems } from "./load-problem-bank.mjs";
const report = JSON.parse(
  readFileSync(
    new URL("../data/question-review/generation-report.json", import.meta.url),
    "utf8",
  ),
);
for (const word of words) {
  for (const type of ["def", "syn", "ant"]) {
    const matching = problems.filter(
      (problem) => problem.wordId === word.id && problem.type === type,
    );
    const excluded = report.excluded.some(
      (row) => row.word === word.word && row.type === type,
    );
    assert.equal(
      matching.length,
      excluded ? 0 : 1,
      `${type}:${word.id}: expected exactly one problem or documented exclusion`,
    );
  }
}
console.log(
  `Validated ${problems.length} questions: ` +
    ["def", "syn", "ant"]
      .map(
        (type) => `${problems.filter((p) => p.type === type).length} ${type}`,
      )
      .join(", "),
);
