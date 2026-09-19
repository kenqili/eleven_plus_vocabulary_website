import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseWord,
  interleaveQuestions,
  reviewDueAt,
} from "../lib/challenge/ordering.ts";

test("730 words get full coverage before regular repeats, with spacing across rounds", () => {
  const candidates = Array.from({ length: 730 }, (_, i) => ({
    id: String(i),
    seen: 0,
    retryAt: null,
  }));
  const recent = [];
  for (let i = 0; i < 1460; i++) {
    const id = chooseWord(candidates, recent, i);
    assert.ok(!recent.slice(0, 20).includes(id));
    candidates.find((word) => word.id === id).seen++;
    recent.unshift(id);
    if (i === 729) assert.equal(new Set(recent).size, 730);
  }
  assert.ok(candidates.every((word) => word.seen === 2));
});

test("due mistakes override recent-word spacing and exposure counts", () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    seen: i === 0 ? 4 : 0,
    retryAt: i === 0 ? 5 : null,
  }));
  assert.equal(chooseWord(candidates, [], 10), "0");
  assert.equal(chooseWord(candidates, ["0"], 10), "0");
  assert.notEqual(chooseWord(candidates, [], 4), "0");
});

test("small and filtered pools relax spacing without getting stuck", () => {
  const candidates = ["a", "b", "c"].map((id) => ({
    id,
    seen: 1,
    retryAt: null,
  }));
  assert.equal(chooseWord(candidates, ["removed", "c", "b", "a"], 4), "a");
  assert.equal(chooseWord(candidates.slice(0, 1), ["a"], 4), "a");
  assert.equal(chooseWord([], [], 0), null);
  assert.equal(
    chooseWord(candidates, [], 0, () => 0.99),
    "c",
  );
});

test("consecutive mistakes each return exactly 15 questions later, even with repeated mistakes", () => {
  const candidates = Array.from({ length: 730 }, (_, i) => ({
    id: String(i),
    seen: 0,
    retryAt: null,
  }));
  const recent = [];
  const lastMistake = new Map();
  for (let count = 0; count < 120; count++) {
    const id = chooseWord(candidates, recent, count, () => 0);
    if (lastMistake.has(id)) assert.equal(count + 1 - lastMistake.get(id), 15);
    const word = candidates.find((word) => word.id === id);
    word.seen++;
    word.retryAt = reviewDueAt(count + 1);
    lastMistake.set(id, count + 1);
    recent.unshift(id);
  }
  assert.equal(lastMistake.size, 15);
});

test("oldest due review wins over a less-seen newer review", () => {
  assert.equal(
    chooseWord(
      [
        { id: "old", seen: 9, retryAt: 10 },
        { id: "new", seen: 1, retryAt: 12 },
      ],
      ["old"],
      20,
    ),
    "old",
  );
});

test("sample rounds separate types and preserve every question exactly once", () => {
  const questions = ["a", "b", "c", "d", "e"].flatMap((wordId) =>
    ["def", "syn", "ant"].map((type) => ({ wordId, type })),
  );
  for (const random of [() => 0, () => 0.99, Math.random]) {
    const ordered = interleaveQuestions(questions, random);
    assert.equal(new Set(ordered).size, questions.length);
    for (let i = 0; i < ordered.length; i += 5)
      assert.equal(
        new Set(ordered.slice(i, i + 5).map((q) => q.wordId)).size,
        5,
      );
    assert.ok(
      ordered.every((q, i) => !i || q.wordId !== ordered[i - 1].wordId),
    );
  }
  assert.equal(
    interleaveQuestions(
      questions.filter((q) => q.type !== "ant" || q.wordId === "a"),
    ).length,
    11,
  );
  assert.deepEqual(interleaveQuestions([]), []);
});
