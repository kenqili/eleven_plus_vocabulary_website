/**
 * "I know this" masters the shown word without answering it.
 *
 * Three things have to hold at once, and each has failed at least once: the
 * engine must set only the mastered flag (no counters move, because this was
 * not an answer), the word must leave the rotation afterwards, and the session
 * must treat the change as something a flush has to send even though the
 * answer queue is empty. A press that sets a flag nobody reads is the same as
 * no press at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PracticeEngine } from "../lib/challenge/engine.ts";
import { QUESTION_TYPES } from "../lib/challenge/config.ts";
import { testBank } from "./helpers/test-bank.mjs";

/** Deterministic, so a failure is reproducible rather than a bad roll. */
function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const fixedNow = () => Date.parse("2026-09-29T12:00:00Z");

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

test("marking the last open word masters it and ends the pool", () => {
  const bank = testBank("free");
  const ids = bank.words.map((row) => String(row[0]));
  const keep = ids[0];
  // Everything already finished except one word, so the next question is
  // forced and what happens after marking is unambiguous.
  const progress = ids
    .slice(1)
    .map((id) => [id, 0, 0, 0, 1, 1, null, null]);
  const engine = new PracticeEngine({ bank, ...fixture({ progress }) });
  const shown = engine.next();
  assert.ok(shown, "one word is still open, so there is a question");
  assert.equal(shown.wordId, keep);
  const marked = engine.markKnown();
  assert.ok(marked, "the shown word can be marked");
  assert.equal(marked.wordId, keep);
  assert.ok(
    marked.question.answer,
    "the caller needs the answer back to show it",
  );
  assert.equal(marked.question.wordId, keep);
  const rows = new Map(engine.pending().progress.map((row) => [row[0], row]));
  const row = rows.get(keep);
  assert.ok(row, "the marked word has a progress row");
  assert.equal(row[4], 1, "the mastered flag is set");
  assert.equal(row[1], 0, "correct is untouched: this was not an answer");
  assert.equal(row[5], 1, "seen moves by one: the word was just shown");
  assert.equal(
    engine.next(),
    null,
    "a mastered word leaves the rotation, so nothing is left to ask",
  );
  assert.equal(engine.markKnown(), null, "nothing shown, nothing to mark");
});

test("marking with no question shown changes nothing", () => {
  const bank = testBank("free");
  const engine = new PracticeEngine({ bank, ...fixture() });
  assert.equal(engine.markKnown(), null);
});

test("a marked word never comes back from later draws", () => {
  const bank = testBank("free");
  const engine = new PracticeEngine({ bank, ...fixture() });
  const markedIds = new Set();
  for (let i = 0; i < 5; i++) {
    const shown = engine.next();
    assert.ok(shown, `draw ${i} must produce a question`);
    const marked = engine.markKnown();
    assert.ok(marked, `draw ${i} must be markable`);
    markedIds.add(marked.wordId);
  }
  assert.equal(markedIds.size, 5, "five different words were marked");
  for (let i = 0; i < 40; i++) {
    const shown = engine.next();
    if (!shown) break;
    assert.ok(
      !markedIds.has(shown.wordId),
      `${shown.wordId} was marked known and must not be asked again`,
    );
  }
});

test("the session marks without answering: mastery moves, attempts do not", async () => {
  const { ClientSession } = await import("../lib/client/session.ts");
  const bank = testBank("free");
  const period = () => ({
    stories: 0,
    questions: 10,
    correct: 7,
    reveals: 1,
    newWords: 4,
    mastered: 2,
    seconds: 30,
    credits: 0,
  });
  const session = new ClientSession(
    new PracticeEngine({ bank, ...fixture() }),
    {
      total: 0,
      collection: 0,
      mastered: 0,
      correct: 7,
      todaySeconds: 0,
      totalSeconds: 0,
      periods: { today: period(), week: period(), all: period() },
    },
  );
  try {
    const shown = session.next();
    assert.ok(shown, "there is a question to mark");
    const marked = session.markKnown(shown.wordId);
    assert.ok(marked, "the shown word can be marked");
    assert.equal(
      marked.question.answer,
      shown.answer,
      "the UI needs the answer back to reveal it",
    );
    assert.equal(
      session.stats.mastered,
      1,
      "the mastered count moves on this frame",
    );
    assert.equal(
      session.stats.periods.today.questions,
      10,
      "no question was asked, so none is counted",
    );
    assert.equal(
      session.stats.periods.today.correct,
      7,
      "no answer was given, so correctness is untouched",
    );
    assert.equal(
      session.stats.periods.today.mastered,
      3,
      "the finished word is counted where panels read it",
    );
    assert.equal(
      session.dirty,
      true,
      "a state-only change must still get a flush moving",
    );
    assert.equal(
      session.markKnown("definitely-not-the-shown-word"),
      null,
      "only the shown word can be marked",
    );
  } finally {
    session.stop();
  }
});
