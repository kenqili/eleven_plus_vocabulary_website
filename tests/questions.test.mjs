import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { words } from "../scripts/load-word-bank.mjs";
import { problems, synText } from "../scripts/load-problem-bank.mjs";
import { parseProblemCsv } from "../lib/challenge/problems.ts";
import {
  MASTERY_TARGET,
  parsePracticeLevel,
  parseQuestionTypes,
} from "../lib/challenge/config.ts";
import { DIFFICULTY_LEVELS } from "../lib/challenge/difficulty.ts";
test("Shipped question CSVs match the independently reviewed versions", () => {
  const review = JSON.parse(
    readFileSync(
      new URL("../data/question-review/review-report.json", import.meta.url),
      "utf8",
    ),
  );
  for (const type of ["syn", "ant"]) {
    const bytes = readFileSync(new URL(`../data/${type}.csv`, import.meta.url));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      review.final[type].sha256,
      `${type}.csv changed since semantic review`,
    );
    const recorded = review.final[type];
    assert.equal(
      problems.filter((p) => p.type === type).length,
      recorded.currentRows,
    );
    // Rows added after the review are recorded, not counted as reviewed.
    assert.equal(
      recorded.rowsReviewed + (recorded.rowsAddedAfterReview || 0),
      recorded.currentRows,
      `${type}.csv row accounting`,
    );
  }
});
test("Every word has one definition and at most one reviewed synonym/antonym problem", () => {
  const report = JSON.parse(
    readFileSync(
      new URL(
        "../data/question-review/generation-report.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(new Set(problems.map((p) => p.id)).size, problems.length);
  for (const word of words)
    for (const type of ["def", "syn", "ant"]) {
      const expected = report.excluded.some(
        (row) => row.word === word.word && row.type === type,
      )
        ? 0
        : 1;
      assert.equal(
        problems.filter((p) => p.wordId === word.id && p.type === type).length,
        expected,
        `${type}:${word.id}`,
      );
    }
  for (const problem of problems.filter((p) => p.choices)) {
    assert.equal(problem.choices.length, 4);
    assert.equal(new Set(problem.choices.map((x) => x.toLowerCase())).size, 4);
    assert.equal(problem.choices.filter((x) => x === problem.answer).length, 1);
  }
});
test("Malformed problem rows cannot enter the bank", () => {
  const row = (options, answer = "kind") =>
    "problem,options,answer,syn/ant,word\n" +
    ["Choose an opposite", JSON.stringify(options), answer, "ant", "vicious"]
      .map((v) => '"' + v.replaceAll('"', '""') + '"')
      .join(",");
  assert.throws(
    () =>
      parseProblemCsv(row(["kind", "kind", "cruel", "harsh"]), "ant", words),
    /distinct/,
  );
  assert.throws(
    () =>
      parseProblemCsv(
        row(["kind", "good", "cruel", "harsh"], "missing"),
        "ant",
        words,
      ),
    /matching answer/,
  );
  assert.throws(
    () => parseProblemCsv(synText, "ant", words),
    /invalid\/duplicate/,
  );
});
test("Type selection requires one or more known types and mastery is per-word five", () => {
  assert.equal(MASTERY_TARGET, 5);
  assert.deepEqual(parseQuestionTypes(undefined), ["def", "syn", "ant"]);
  assert.deepEqual(parseQuestionTypes(["ant", "syn", "syn"]), ["syn", "ant"]);
  for (const value of [[], ["unknown"], "syn", [null]])
    assert.throws(() => parseQuestionTypes(value), /practice type/);
});
test("Level 0 practises alongside levels 1-5 and only known levels are accepted", () => {
  assert.deepEqual(Object.keys(DIFFICULTY_LEVELS), [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  assert.equal(parsePracticeLevel(undefined), null);
  assert.equal(parsePracticeLevel("all"), null);
  for (const level of [0, 1, 2, 3, 4, 5]) {
    assert.equal(parsePracticeLevel(level), level);
    assert.equal(parsePracticeLevel(String(level)), level);
  }
  for (const value of ["6", -1, 1.5, "curriculum", true, {}])
    assert.throws(() => parsePracticeLevel(value), /practice level/);
  // The five original bands keep their words; only curriculum words take level 0.
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../data/word-levels/levels.json", import.meta.url),
      "utf8",
    ),
  ).words;
  const levelFor = (id) => snapshot[id]?.difficulty;
  const counts = [0, 1, 2, 3, 4, 5].map(
    (level) => words.filter((word) => levelFor(word.id) === level).length,
  );
  assert.deepEqual(counts, [117, 146, 146, 146, 146, 146]);
  assert.equal(
    words.every(
      (word) => (levelFor(word.id) === 0) === (word.source === "curriculum"),
    ),
    true,
  );
});
