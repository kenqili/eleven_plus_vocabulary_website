import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { words } from "../scripts/load-word-bank.mjs";
import { problems, synText } from "../scripts/load-problem-bank.mjs";
import { choicesForProblem } from "../lib/challenge/bank.ts";
import { hasWholeWord, parseProblemCsv } from "../lib/challenge/problems.ts";
import { parsePracticeLevel, parseQuestionTypes } from "../lib/challenge/config.ts";
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
    // Rows added and removed after the review are both recorded, so the
    // accounting still adds up and neither is quietly counted as reviewed.
    const after =
      (recorded.rowsAddedAfterReview || 0) - (recorded.rowsRemovedAfterReview || 0);
    assert.equal(
      recorded.rowsReviewed + after,
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
      // A definition question is also impossible for a word whose definition
      // contains the word, because the answer would then be the only option
      // that mentions it. Two words are in that position.
      const selfNaming = hasWholeWord(word.definition, word.word);
      const expected =
        report.excluded.some(
          (row) => row.word === word.word && row.type === type,
        ) || (type === "def" && selfNaming)
          ? 0
          : 1;
      assert.equal(
        problems.filter((p) => p.wordId === word.id && p.type === type).length,
        expected,
        `${type}:${word.id}`,
      );
    }
  // The bank stores a pool of wrong options with the answer kept apart, and
  // joins three of them when a question is asked. What a child is shown is
  // what is checked, because that is the thing that has to be right.
  for (const problem of problems.filter((p) => p.choices)) {
    assert.ok(
      problem.choices.length >= 3,
      `${problem.id}: pool holds ${problem.choices.length}`,
    );
    assert.ok(
      !problem.choices.includes(problem.answer),
      `${problem.id}: the answer is stored among the wrong options`,
    );
    // Every rotation window is a valid question: four unique options with
    // the answer exactly once, wherever in the pool the window starts.
    for (const seed of [0, 0.2, 0.5, 0.8]) {
      const shown = choicesForProblem(problem, () => seed);
      assert.equal(shown.length, 4, problem.id);
      assert.equal(
        new Set(shown.map((x) => x.toLowerCase())).size,
        4,
        problem.id,
      );
      assert.equal(
        shown.filter((x) => x === problem.answer).length,
        1,
        problem.id,
      );
    }
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
test("Type selection requires one or more known types and mastery is per-word", () => {
  assert.deepEqual(parseQuestionTypes(undefined), [
    "def",
    "syn",
    "ant",
    "word",
    "cloze",
  ]);
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
  // Level 0 is the curriculum extension plus the words named as everyday in
  // data/word-levels/everyday-words.json. Those words are taken out of the
  // bands after the bands themselves are cut, so a word moves to Level 0 and
  // no other word changes level.
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../data/word-levels/levels.json", import.meta.url),
      "utf8",
    ),
  ).words;
  const listed = JSON.parse(
    readFileSync(
      new URL("../data/word-levels/everyday-words.json", import.meta.url),
      "utf8",
    ),
  ).words;
  const everyday = new Set(listed);
  const levelFor = (id) => snapshot[id]?.difficulty;
  assert.equal(everyday.size, listed.length, "everyday-words.json repeats a word");
  const byId = new Map(words.map((word) => [word.id, word]));
  for (const id of everyday)
    assert.ok(
      byId.has(id),
      `everyday-words.json names "${id}", which is not in the bank`,
    );

  const counts = [0, 1, 2, 3, 4, 5].map(
    (level) => words.filter((word) => levelFor(word.id) === level).length,
  );
  assert.equal(
    counts[0],
    words.filter((word) => word.source === "curriculum").length + everyday.size,
    "Level 0 is not exactly the curriculum words plus the everyday list",
  );

  const core = words
    .filter((word) => word.source !== "curriculum")
    .sort(
      (a, b) =>
        snapshot[a.id].score - snapshot[b.id].score ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const sliceOf = (index) => Math.min(5, Math.floor((index * 5) / core.length) + 1);
  for (const [index, word] of core.entries()) {
    const sliced = sliceOf(index);
    const want = everyday.has(word.id) ? 0 : sliced;
    assert.equal(
      levelFor(word.id),
      want,
      `${word.word} is level ${levelFor(word.id)}, not ${want} (slice ${sliced}${everyday.has(word.id) ? ", listed as everyday" : ""})`,
    );
  }
});
