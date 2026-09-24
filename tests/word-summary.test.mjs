import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { words } from "../scripts/load-word-bank.mjs";
import {
  learningStatus,
  filterWords,
  wordSummaryCsv,
} from "../lib/challenge/word-summary.ts";
import { parseCsv } from "../lib/challenge/words.ts";
import {
  readAutoNext,
  saveAutoNext,
  subscribeAutoNext,
  serverAutoNext,
} from "../lib/client/auto-next.ts";

test("revision filters prioritise mistakes, distinguish reveals, and keep mastered history", () => {
  const row = (word, correct, seen, mistakes, reveals) => ({
    difficulty: word === "revealed" ? 5 : 1,
    letterCount: word.length,
    frequencyZipf: 4,
    frequencyKind: "word",
    id: word,
    word,
    definition: "A meaning",
    example: "",
    syn: "",
    ant: "",
    lastPractised: null,
    correct,
    seen,
    mistakes,
    reveals,
    status: learningStatus(correct, seen, mistakes, reveals),
  });
  const rows = [
    row("new", 0, 0, 0, 0),
    row("learning", 1, 1, 0, 0),
    row("mistaken", 1, 3, 2, 0),
    row("revealed", 0, 3, 0, 3),
    row("mastered", 5, 7, 2, 0),
  ];
  assert.deepEqual(
    rows.map((r) => r.status),
    ["new", "learning", "practice", "practice", "mastered"],
  );
  assert.deepEqual(
    filterWords(rows, "practice").map((r) => r.word),
    ["revealed", "mistaken"],
  );
  assert.deepEqual(
    filterWords(rows, "mistakes").map((r) => r.word),
    ["mastered", "mistaken"],
  );
  assert.deepEqual(
    filterWords(rows, "revealed").map((r) => r.word),
    ["revealed"],
  );
  assert.equal(filterWords(rows, "practice", "  MISTAKEN  ").length, 1);
  assert.equal(filterWords(rows, "mastered", "unknown").length, 0);
  assert.deepEqual(
    filterWords(rows, "practice", "", 5).map((word) => word.word),
    ["revealed"],
  );
  assert.deepEqual(
    filterWords(rows, "practice", "", 1).map((word) => word.word),
    ["mistaken"],
  );
  assert.equal(filterWords(rows, "practice", "mistaken", 5).length, 0);
});
test("CSV exports preserve punctuation and neutralise spreadsheet formulas", () => {
  const csv = wordSummaryCsv([
    {
      difficulty: 3,
      letterCount: 9,
      frequencyZipf: 3.5,
      frequencyKind: "word",
      word: '=HYPERLINK("test")',
      definition: 'A "quoted", multiline\nmeaning',
      example: "+1",
      syn: "",
      ant: "",
      status: "practice",
      correct: 1,
      seen: 2,
      mistakes: 1,
      reveals: 0,
      lastPractised: null,
    },
  ]);
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], '\'=HYPERLINK("test")');
  assert.equal(rows[1][1], 'A "quoted", multiline\nmeaning');
  assert.equal(rows[1][2], "'+1");
  assert.equal(rows[1].length, rows[0].length);
});
test("auto-next survives remounts, synchronises tabs and tolerates unavailable storage", () => {
  const values = new Map();
  const events = new EventTarget();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: events,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  try {
    assert.equal(serverAutoNext(), false);
    let changes = 0;
    const unsubscribe = subscribeAutoNext(() => changes++);
    saveAutoNext(true);
    assert.equal(readAutoNext(), true);
    assert.equal(changes, 1);
    unsubscribe();
    const remount = subscribeAutoNext(() => changes++);
    assert.equal(readAutoNext(), true);
    values.set("minewords.auto-next", "false");
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: "minewords.auto-next" });
    events.dispatchEvent(event);
    assert.equal(readAutoNext(), false);
    assert.equal(changes, 2);
    remount();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Blocked");
      },
    });
    saveAutoNext(true);
    assert.equal(readAutoNext(), true);
    saveAutoNext(false);
    assert.equal(readAutoNext(), false);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
    if (oldStorage)
      Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete globalThis.localStorage;
  }
});

test("difficulty snapshot covers the word bank with reproducible length/frequency bands", () => {
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../data/word-levels/levels.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    snapshot.wordIdsSha256,
    createHash("sha256")
      .update(words.map((word) => word.id).join("\n"))
      .digest("hex"),
  );
  assert.deepEqual(
    Object.keys(snapshot.words).sort(),
    words.map((word) => word.id).sort(),
  );
  for (const word of words) {
    const info = snapshot.words[word.id];
    assert.equal(
      info.letterCount,
      [...word.word].filter((letter) => /\p{L}/u.test(letter)).length,
    );
    assert.ok(
      Number.isFinite(info.frequencyZipf) &&
        info.frequencyZipf >= 0 &&
        info.frequencyZipf <= 8,
    );
    assert.ok([1, 2, 3, 4, 5].includes(info.difficulty));
    const rarity = 1 - Math.min(1, Math.max(0, (info.frequencyZipf - 1) / 5));
    const length = Math.min(1, Math.max(0, (info.letterCount - 3) / 12));
    assert.equal(
      info.score,
      Number((100 * (0.7 * rarity + 0.3 * length)).toFixed(4)),
    );
    assert.equal(
      info.frequencyKind === "unavailable",
      info.frequencyZipf === 0,
    );
  }
  const sorted = Object.entries(snapshot.words).sort(
    ([a, x], [b, y]) => x.score - y.score || (a < b ? -1 : a > b ? 1 : 0),
  );
  sorted.forEach(([, row], index) =>
    assert.equal(
      row.difficulty,
      Math.min(5, Math.floor((index * 5) / sorted.length) + 1),
    ),
  );
  for (let level = 1; level <= 5; level++)
    assert.equal(
      sorted.filter(([, row]) => row.difficulty === level).length,
      snapshot.counts[level],
    );
});
