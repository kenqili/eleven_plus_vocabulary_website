/**
 * "I know this" retires a word that was just answered right.
 *
 * Three things have to hold at once, and each has failed at least once: the
 * engine must set only the mastered flag (the press is not an answer, so it moves
 * nothing an answer moves), the word must leave the rotation afterwards, and the
 * session must treat the change as something a flush has to send even though the
 * answer queue may already be empty. A press that sets a flag nobody reads is the
 * same as no press at all.
 *
 * And the rule that makes the press a claim rather than a shortcut: with no
 * answer yet, or a wrong one, it does nothing at all. The answer is what backs it.
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

/** Answer the shown question correctly; returns the word id that was answered. */
function answerRight(engine) {
  const shown = engine.next();
  assert.ok(shown, "there is a question to answer");
  const graded = engine.grade(shown.choices.indexOf(shown.answer));
  assert.ok(graded?.correct, "the fixture answered it right");
  return shown;
}

test("marking the word just answered right masters it without moving the answer", () => {
  const bank = testBank("free");
  const engine = new PracticeEngine({ bank, ...fixture() });
  const shown = answerRight(engine);
  const before = new Map(
    engine.pending().progress.map((row) => [row[0], row]),
  );
  const marked = engine.markKnown();
  assert.ok(marked, "a word just answered right can be marked");
  assert.equal(marked.wordId, shown.wordId);
  assert.equal(marked.question.wordId, shown.wordId);
  assert.ok(
    marked.question.answer,
    "the caller needs the answer back to show it",
  );
  const rows = new Map(engine.pending().progress.map((row) => [row[0], row]));
  const row = rows.get(shown.wordId);
  const answered = before.get(shown.wordId);
  assert.ok(row, "the marked word has a progress row");
  assert.equal(row[4], 1, "the mastered flag is set");
  assert.equal(
    row[1],
    answered[1],
    "correct is the answer's count, not a second one",
  );
  assert.equal(
    row[5],
    answered[5],
    "seen is not counted twice: the answer counted this showing",
  );
  assert.equal(row[2], answered[2], "the run is the answer's");
  assert.equal(row[3], answered[3], "the recalls are the answer's");
  assert.equal(engine.pending().attemptCount, 1, "the press adds no attempt");
});

test("marking is refused before an answer, after a wrong one, and once the next word is on screen", () => {
  const bank = testBank("free");
  const engine = new PracticeEngine({ bank, ...fixture() });
  const shown = engine.next();
  assert.ok(shown, "there is a question to answer");
  assert.equal(engine.markKnown(), null, "nothing has been answered yet");

  const wrong = shown.choices.findIndex((choice) => choice !== shown.answer);
  const missed = engine.grade(wrong);
  assert.ok(missed && !missed.correct, "the fixture answered it wrong");
  assert.equal(
    engine.markKnown(),
    null,
    "a wrong answer cannot be marked known",
  );

  answerRight(engine);
  engine.next();
  assert.equal(
    engine.markKnown(),
    null,
    "the claim belongs to the word still on screen, and a new one is on it",
  );
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
    const shown = answerRight(engine);
    const marked = engine.markKnown();
    assert.ok(marked, `draw ${i} must be markable`);
    assert.equal(marked.wordId, shown.wordId);
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

test("marking the last open word masters it and ends the pool", () => {
  const bank = testBank("free");
  const ids = bank.words.map((row) => String(row[0]));
  const keep = ids[0];
  // Everything already finished except one word, so the next question is
  // forced and what happens after marking is unambiguous.
  const progress = ids.slice(1).map((id) => [id, 0, 0, 0, 1, 1, null, null]);
  const engine = new PracticeEngine({ bank, ...fixture({ progress }) });
  const shown = engine.next();
  assert.ok(shown, "one word is still open, so there is a question");
  assert.equal(shown.wordId, keep);
  engine.grade(shown.choices.indexOf(shown.answer));
  const marked = engine.markKnown();
  assert.ok(marked, "the word just answered can be marked");
  assert.equal(marked.wordId, keep);
  assert.ok(
    marked.question.answer,
    "the caller needs the answer back to show it",
  );
  assert.equal(marked.question.wordId, keep);
  assert.equal(
    engine.next(),
    null,
    "a mastered word leaves the rotation, so nothing is left to ask",
  );
  assert.equal(engine.markKnown(), null, "nothing shown, nothing to mark");
});

test("the session marks after answering: mastery moves, no attempt is added, and the state still needs a flush", async () => {
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
  // The flush is stubbed at the network edge: what matters here is what the
  // session decides to send, not what the server does with it (the integration
  // test covers that).
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ saved: 1, stats: session.stats }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const shown = session.next();
    assert.ok(shown, "there is a question to answer");
    const answered = session.answer(shown.choices.indexOf(shown.answer));
    assert.ok(answered?.feedback.correct, "the fixture answered it right");
    assert.equal(
      session.stats.periods.today.questions,
      11,
      "the answer counted one question",
    );
    await session.flush();
    assert.equal(session.dirty, false, "everything the answer produced is saved");

    const marked = session.markKnown(shown.wordId);
    assert.ok(marked, "the word just answered right can be marked");
    assert.equal(
      marked.question.answer,
      shown.answer,
      "the UI needs the answer back to show it",
    );
    assert.equal(
      session.stats.mastered,
      1,
      "the mastered count moves on this frame",
    );
    assert.equal(
      session.stats.periods.today.questions,
      11,
      "the press asks no question of its own",
    );
    assert.equal(
      session.stats.periods.today.correct,
      8,
      "the answer's correctness stands, and the press adds none",
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
    await session.flush();
    const last = sent.at(-1);
    assert.deepEqual(last.answers, [], "the press carries no answer");
    const row = last.state.progress.find((entry) => entry[0] === shown.wordId);
    assert.ok(row, "the marked word is in the state");
    assert.equal(row[4], 1, "the mastered flag travels in the state");
    assert.equal(
      session.markKnown("definitely-not-the-shown-word"),
      null,
      "only the shown word can be marked",
    );
  } finally {
    globalThis.fetch = originalFetch;
    session.stop();
  }
});
