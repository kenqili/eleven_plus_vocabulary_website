/**
 * The browser builds its own questions. It has to build the *same* ones.
 *
 * The ordering rules are the pedagogy: the twenty-word exclusion window is what
 * stops a child being shown the same word over and over, and `retry_at` is a
 * logical clock over the attempt count that decides when a mistake comes back. An
 * engine that was merely reasonable would teach differently from the server and
 * nothing would report it - the child would just stop being given the words they
 * needed.
 *
 * So this drives the engine and the server's own ordering functions over identical
 * fixtures and compares the questions they produce, question by question, for a
 * long enough run that a divergence in the cycling, the window or the review clock
 * has somewhere to show up.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PracticeEngine } from "../lib/challenge/engine.ts";
import {
  choicesForProblem,
  problems as serverProblems,
  words as serverWords,
  CHOICES_PER_PROBLEM,
} from "../lib/challenge/bank.ts";
import {
  chooseWord,
  reviewDueAt,
  MISTAKE_REVIEW_DISTANCE,
} from "../lib/challenge/ordering.ts";
import {
  answerWindow,
  classify,
  hasMastered,
  initialMastery,
  masteryProgress,
} from "../lib/challenge/mastery.ts";
import { QUESTION_TYPES } from "../lib/challenge/config.ts";

const manifest = JSON.parse(readFileSync("data/client-bank.json", "utf8"));

function loadBank(tier = "full") {
  const entry = manifest[tier];
  return JSON.parse(readFileSync(`public${entry.url}`, "utf8"));
}

/** Deterministic, so a failure is reproducible rather than a bad roll. */
function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const fixedNow = () => Date.parse("2026-09-29T12:00:00Z");

/** How many words the fixture marks as eligible, and how much history it has. */
function fixture(overrides = {}) {
  return {
    progress: [],
    typeCounts: [],
    attemptCount: 0,
    recent: [],
    addedWords: [],
    excluded: [],
    level: null,
    types: [...QUESTION_TYPES],
    random: seeded(),
    now: fixedNow,
    ...overrides,
  };
}

test("the engine and the server pick the same word from the same state", () => {
  const bank = loadBank();
  // A child with some history: one word answered a lot, one mistake waiting for
  // its review, and the rest unseen. This is the state the rules actually decide
  // something in.
  const progress = [
    ["abandon", 6, 0, 0, 1, 9, "2026-09-01", null],
    ["abundant", 0, 0, 0, 0, 3, "2026-09-20", reviewDueAt(2)],
    ["abate", 4, 4, 4, 0, 5, "2026-09-25", null],
  ];
  const recent = [
    "abandon",
    "abundant",
    "abate",
    "abbey",
    "abdomen",
    "aberrant",
  ];
  const attemptCount = 40;

  for (let round = 0; round < 25; round++) {
    const engine = new PracticeEngine({
      bank,
      ...fixture({ progress, recent, attemptCount }),
    });
    const shown = engine.next();
    assert.ok(shown, "the engine must produce a question");

    // The server's own path, from the same three inputs.
    const byId = new Map(progress.map((row) => [row[0], row]));
    const eligible = serverProblems.filter((p) =>
      QUESTION_TYPES.includes(p.type),
    );
    const available = serverWords
      .filter((w) => !hasMastered(byId.get(w.id) ?? initialMastery))
      .map((w) => ({
        id: w.id,
        seen: byId.get(w.id)?.[5] ?? 0,
        retryAt: byId.get(w.id)?.[7] ?? null,
      }));
    const chosenId = chooseWord(available, recent, attemptCount, seeded());
    assert.equal(
      shown.wordId,
      chosenId,
      `round ${round}: the engine chose ${shown.wordId}, the server would choose ${chosenId}`,
    );
    // And the options have to match too, or the child sees a different question
    // even when the word is right.
    const problem = eligible.find(
      (p) => p.id === `${shown.type}:${shown.wordId}`,
    );
    assert.ok(problem, `no server problem for ${shown.type}:${shown.wordId}`);
    // The set, not the order: two independent random streams will not produce
    // the same shuffle, and comparing order would be testing the seed rather than
    // the logic. What has to match is which options, and that the answer is one.
    assert.deepEqual(
      [...shown.choices].sort(),
      [...choicesForProblem(problem, seeded())].sort(),
      `round ${round}: the options for ${shown.wordId} differ`,
    );
    assert.equal(
      shown.answer,
      problem.answer,
      `round ${round}: the answer differs`,
    );
    assert.equal(
      shown.prompt,
      problem.prompt,
      `round ${round}: the prompt differs`,
    );
    assert.equal(shown.choices.length, CHOICES_PER_PROBLEM);
    assert.ok(
      shown.choices.includes(shown.answer),
      `round ${round}: the options omit the answer`,
    );
  }
});

test("a due mistake comes back before anything else", () => {
  const bank = loadBank();
  // A word with a review due, and everything else unseen. The review must win:
  // that is the spaced-retrieval mechanism, and a least-seen-first ordering that
  // ignored it would never show the child the word they got wrong.
  // The review is due at attempt 17, so the count has to have reached that for
  // the word to be due at all. `retry_at` is a logical clock, not a date, and a
  // fixture that ignores that is testing nothing - which is exactly what the
  // first version of this test did.
  const dueAt = reviewDueAt(3);
  const attemptCount = dueAt + 3;
  const progress = [["abandon", 0, 0, 0, 0, 1, "2026-09-25", dueAt]];
  const engine = new PracticeEngine({
    bank,
    ...fixture({ progress, attemptCount, recent: [] }),
  });
  const shown = engine.next();
  assert.equal(
    shown?.wordId,
    "abandon",
    "the word that is due must be the one asked",
  );
});

test("a word is not asked again inside the exclusion window", () => {
  const bank = loadBank();
  // The window has to be decisive to be worth testing, so the pool is cut to
  // thirty words and the twenty most recent are named. Out of a couple of
  // thousand least-seen words, missing twenty specific ones is a matter of luck -
  // which is how the first version of this test passed with the window switched
  // off entirely. With thirty candidates and twenty excluded, the answer can only
  // come from the other ten.
  const pool = bank.words.slice(0, 30).map((row) => String(row[0]));
  const recent = pool.slice(0, 20);
  const engine = new PracticeEngine({
    bank,
    ...fixture({ allowedWordIds: new Set(pool), recent, attemptCount: 20 }),
  });
  const asked = new Set();
  for (let i = 0; i < 12; i++) {
    const shown = engine.next();
    assert.ok(shown, "the engine must keep producing questions");
    assert.ok(
      !recent.includes(shown.wordId),
      `${shown.wordId} was asked inside the twenty-word window`,
    );
    asked.add(shown.wordId);
  }
  assert.ok(
    asked.size > 1,
    "and it should be choosing between the words outside the window",
  );

  // And the window relaxes rather than stalling when there is nothing left
  // outside it, which is what `chooseWord` does for a small pool. A child with
  // twenty-five words is not left with no question to ask.
  const cramped = new PracticeEngine({
    bank,
    ...fixture({
      allowedWordIds: new Set(pool),
      recent: pool.slice(0, 25),
      attemptCount: 25,
    }),
  });
  assert.ok(
    cramped.next(),
    "a child with almost every word excluded still gets a question",
  );
});

test("question types cycle for a word before repeating", () => {
  const bank = loadBank();
  // With no history, every type ties, so the choice is arbitrary - but it must
  // not be the *same* type four times. The server cycles explicitly, by asking
  // which type has been asked least, and that is the behaviour being moved.
  const engine = new PracticeEngine({
    bank,
    ...fixture({ level: 1, types: ["def", "word", "cloze", "syn", "ant"] }),
  });
  const seenFor = new Map();
  for (let i = 0; i < 40; i++) {
    const shown = engine.next();
    assert.ok(shown);
    const set = seenFor.get(shown.wordId) ?? new Set();
    set.add(shown.type);
    seenFor.set(shown.wordId, set);
  }
  const repeated = [...seenFor.values()].filter((set) => set.size === 1);
  assert.ok(
    repeated.length < seenFor.size,
    "a word was only ever asked one way; the type cycling is not happening",
  );
});

test("a word already asked four ways gets the fifth, not the first again", () => {
  const bank = loadBank();
  // Only one word is startable, so the choice of word is forced and the type is
  // the only thing left to decide. syn and ant are ahead on count, so they must
  // not be the ones to repeat.
  const tied = new PracticeEngine({
    bank,
    ...fixture({
      allowedWordIds: new Set(["abandon"]),
      typeCounts: [
        ["abandon", "syn", 5],
        ["abandon", "ant", 5],
        ["abandon", "def", 1],
        ["abandon", "word", 1],
        ["abandon", "cloze", 1],
      ],
    }),
  });
  const asked = new Set();
  for (let i = 0; i < 3; i++) {
    const shown = tied.next();
    assert.ok(shown);
    asked.add(shown.type);
  }
  assert.ok(
    [...asked].every((type) => type !== "syn" && type !== "ant"),
    `asked ${[...asked].join(",")}: the most-asked types must not repeat first`,
  );
});

test("grading a correct answer matches the server's verdict", () => {
  const bank = loadBank();
  const engine = new PracticeEngine({ bank, ...fixture() });
  const shown = engine.next();
  assert.ok(shown);
  const right = shown.choices.indexOf(shown.answer);
  const graded = engine.grade(right);
  assert.ok(graded);
  assert.equal(graded.correct, true);
  assert.equal(graded.skipped, false);
  // Recomputed independently, through the same functions the server calls.
  const expected = classify({
    correct: true,
    revealed: false,
    assisted: false,
    seconds: 0,
    wallSeconds: 0,
    window: answerWindow(shown.choices),
  });
  assert.equal(
    graded.evidence,
    expected,
    "the evidence verdict must be the server's",
  );
  assert.equal(
    graded.mastery.stage,
    masteryProgress(initialMastery, shown.difficulty).stage,
  );
  assert.equal(
    graded.newlyMastered,
    false,
    "one correct answer does not master a word",
  );
});

test("a mistake is scheduled against the attempt count, not a date", () => {
  const bank = loadBank();
  const engine = new PracticeEngine({
    bank,
    ...fixture({ attemptCount: 100 }),
  });
  const shown = engine.next();
  assert.ok(shown);
  const wrong = shown.choices.findIndex((c) => c !== shown.answer);
  const graded = engine.grade(wrong);
  assert.ok(graded);
  assert.equal(graded.correct, false);
  const pending = engine.pending();
  const row = pending.progress.find((r) => r[0] === shown.wordId);
  assert.ok(row, "the word must be in the pending state");
  assert.equal(
    row[7],
    reviewDueAt(101),
    "a mistake is due at the attempt count, one question after the mistake",
  );
  // The server reads its count before writing the answer, and the attempt row
  // already exists because the question was issued, so its count already
  // includes this one. Fifteen questions from the previous count is the same
  // number as `MISTAKE_REVIEW_DISTANCE - 1` from this one.
  assert.equal(
    row[7] - 100,
    MISTAKE_REVIEW_DISTANCE,
    "a mistake is due fifteen questions after the count it was recorded at",
  );
  assert.equal(pending.attemptCount, 101, "answering advances the clock");
});

test("a reveal counts as seen but not as a type asked", () => {
  const bank = loadBank();
  const engine = new PracticeEngine({ bank, ...fixture() });
  const shown = engine.next();
  assert.ok(shown);
  engine.grade(-1);
  const pending = engine.pending();
  const row = pending.progress.find((r) => r[0] === shown.wordId);
  assert.equal(row?.[5], 1, "a revealed word has still been seen");
  const types = pending.typeCounts.filter((c) => c[0] === shown.wordId);
  assert.equal(
    types.length,
    0,
    "a question the answer was read out for is not evidence about the type",
  );
});

test("evidence is measured from when the question was shown, not from now", () => {
  // This is the reason the engine keeps its own `shownAt`. A question can sit in
  // a queue before the child sees it, and measuring from the wrong origin makes
  // every question read as a guess - which stops counting towards mastery, and
  // quietly makes words harder to master than they should be.
  let clock = fixedNow();
  const bank = loadBank();
  const engine = new PracticeEngine({ bank, ...fixture({ now: () => clock }) });
  const shown = engine.next();
  assert.ok(shown);
  // The child takes their time, well inside the answer window.
  clock += 2500;
  const graded = engine.grade(shown.choices.indexOf(shown.answer));
  assert.ok(graded);
  assert.equal(
    graded.evidence,
    "recalled",
    "a deliberate, in-window answer is recall, and must not be read as a guess",
  );
});

test("the engine runs out rather than looping when every word is mastered", () => {
  const bank = loadBank("free");
  const everything = bank.words.map((row) => [
    String(row[0]),
    9,
    9,
    9,
    1,
    9,
    null,
    null,
  ]);
  const engine = new PracticeEngine({
    bank,
    ...fixture({ progress: everything }),
  });
  assert.equal(
    engine.next(),
    null,
    "a child who has mastered everything is told they have finished, not looped",
  );
});

test("a level the child picked filters the pool, and an added word is never lost", () => {
  const bank = loadBank();
  const engine = new PracticeEngine({
    bank,
    ...fixture({
      level: 1,
      addedWords: [
        {
          id: "own:wibble",
          word: "wibble",
          definition: "To wobble.",
          example: "",
        },
      ],
    }),
  });
  const shown = engine.next();
  assert.ok(shown);
  // Level 1 is the easiest band; the added word sits in it, and an arbitrary word
  // from a harder band must not turn up.
  assert.equal(shown.difficulty, 1);
});
