import test from "node:test";
import assert from "node:assert/strict";
import {
  CUMULATIVE_FLOOR,
  MIN_READ_SECONDS,
  RECALL_TARGET,
  RUN_TARGET,
  WALL_SLACK_SECONDS,
  advanceMastery,
  answerWindow,
  classify,
  describeRecallTargets,
  hasMastered,
  initialMastery,
  masteryProgress,
  recallTarget,
  runTarget,
} from "../lib/challenge/mastery.ts";
const answer = (over = {}) =>
  classify({
    correct: true,
    revealed: false,
    assisted: false,
    seconds: 8,
    wallSeconds: 8.5,
    window: 15,
    ...over,
  });
const play = (level, evidence, from = initialMastery) =>
  evidence.reduce((state, item) => advanceMastery(state, item, level), from);

test("Timing separates an unhurried answer from a reflex or a guessed one", () => {
  assert.equal(answer({ seconds: 8 }), "recalled");
  assert.equal(
    answer({ seconds: MIN_READ_SECONDS, wallSeconds: 2.5 }),
    "recalled",
  );
  assert.equal(
    answer({ seconds: MIN_READ_SECONDS - 1, wallSeconds: 1.5 }),
    "uncertain",
  );
  assert.equal(answer({ wallSeconds: MIN_READ_SECONDS - 1 }), "uncertain");
  assert.equal(answer({ seconds: 15, wallSeconds: 15.5 }), "recalled");
  assert.equal(
    answer({ seconds: 16, wallSeconds: 16.5 }),
    "uncertain",
    "past the reading window",
  );
  assert.equal(answer({ wallSeconds: 15 + WALL_SLACK_SECONDS }), "recalled");
  assert.equal(
    answer({ wallSeconds: 15 + WALL_SLACK_SECONDS + 1 }),
    "uncertain",
  );
  // The reported time has to fit inside real time, so a restored question cannot
  // claim a fresh reading budget.
  assert.equal(
    answer({ seconds: 14, wallSeconds: 3 }),
    "uncertain",
    "reported time longer than the wall clock",
  );
  assert.equal(
    answer({ seconds: 15, wallSeconds: 9 }),
    "uncertain",
    "the same rule applies at the window edge",
  );
  assert.equal(answer({ seconds: 8, wallSeconds: 8.5 }), "recalled");
  for (const value of [Number.NaN, Infinity, -1])
    assert.equal(answer({ seconds: value }), "uncertain");
});

test("A wrong answer, a reveal and a clue are all evidence against recall", () => {
  assert.equal(answer({ correct: false }), "missed");
  assert.equal(answer({ correct: true, revealed: true }), "missed");
  assert.equal(answer({ correct: false, revealed: true }), "missed");
  assert.equal(
    answer({ assisted: true, seconds: 8 }),
    "assisted",
    "a clue is stronger evidence than any timing",
  );
  assert.equal(
    answer({ correct: false, assisted: true }),
    "missed",
    "a wrong answer stays a miss",
  );
});

test("The timing signal is never dead: a run always costs more than recalls", () => {
  for (let level = 0; level < RECALL_TARGET.length; level++) {
    assert.ok(
      RUN_TARGET[level] > RECALL_TARGET[level] ||
        RUN_TARGET[level] === CUMULATIVE_FLOOR,
      `level ${level}: the unconfident path must be longer, or the timing signal decides nothing`,
    );
    assert.equal(recallTarget(level), RECALL_TARGET[level]);
    assert.equal(runTarget(level), RUN_TARGET[level]);
  }
  // Easier words never need more evidence than harder ones.
  for (let level = 1; level < RECALL_TARGET.length; level++)
    assert.ok(recallTarget(level) >= recallTarget(level - 1));
  assert.deepEqual(RECALL_TARGET, [2, 3, 3, 4, 4, 4]);
  assert.deepEqual(RUN_TARGET, [3, 4, 4, 5, 5, 5]);
  // An unknown level falls back to the hardest band instead of throwing.
  assert.equal(recallTarget(99), recallTarget(5));
  assert.equal(recallTarget(-1), recallTarget(5));
  assert.equal(recallTarget(1.5), recallTarget(5));
});

test("Level 0 masters on two sure recalls, never on one lucky guess", () => {
  const one = play(0, ["recalled"]);
  assert.equal(one.mastered, false);
  assert.equal(one.recalls, 1);
  assert.equal(one.correct, 1);
  const two = play(0, ["recalled", "recalled"]);
  assert.equal(two.mastered, true);
  assert.equal(play(0, ["recalled", "recalled"]).newlyMastered, true);
  // Two fast correct guesses are not recall, so the word stays in rotation.
  const guessed = play(0, ["uncertain", "uncertain"]);
  assert.equal(guessed.mastered, false);
  assert.equal(guessed.recalls, 0);
  assert.equal(guessed.run, 2);
  assert.equal(guessed.correct, 2);
  // A guess then a sure recall still needs the second recall.
  assert.equal(play(0, ["uncertain", "recalled"]).mastered, false);
  assert.equal(play(0, ["uncertain", "recalled", "recalled"]).mastered, true);
});

test("Harder words need more sure recalls, and blind guesses cannot shortcut them", () => {
  // Level 0 is the one band where three right answers in a row are enough on their own.
  assert.equal(play(0, ["uncertain", "uncertain", "uncertain"]).mastered, true);
  for (let level = 1; level < 6; level++) {
    assert.equal(
      play(level, ["uncertain", "uncertain", "uncertain"]).mastered,
      false,
      `level ${level}: three guesses must not master a word`,
    );
  }
  assert.equal(play(1, ["recalled", "recalled", "recalled"]).mastered, true);
  assert.equal(play(1, ["recalled", "recalled", "uncertain"]).mastered, false);
  assert.equal(
    play(1, ["recalled", "recalled", "recalled", "recalled"]).mastered,
    true,
  );
  assert.equal(play(2, ["recalled", "recalled", "recalled"]).mastered, true);
  assert.equal(play(3, ["recalled", "recalled", "recalled"]).mastered, false);
  assert.equal(
    play(3, ["recalled", "recalled", "recalled", "recalled"]).mastered,
    true,
  );
  for (let level = 4; level < 6; level++) {
    assert.equal(
      play(level, ["recalled", "recalled", "recalled"]).mastered,
      false,
    );
    assert.equal(
      play(level, ["recalled", "recalled", "recalled", "recalled"]).mastered,
      true,
    );
  }
});

test("Right answers in a row master a word when the timing was unconvincing", () => {
  assert.equal(play(0, ["recalled", "uncertain", "uncertain"]).mastered, true);
  assert.equal(play(0, ["uncertain", "uncertain", "uncertain"]).mastered, true);
  assert.equal(
    play(1, ["uncertain", "uncertain", "uncertain"]).mastered,
    false,
    "level 1 needs four in a row, not three",
  );
  assert.equal(
    play(1, ["uncertain", "uncertain", "uncertain", "uncertain"]).mastered,
    true,
  );
  assert.equal(
    play(5, ["uncertain", "uncertain", "uncertain", "uncertain"]).mastered,
    false,
    "the hardest words need the cumulative floor instead",
  );
  assert.equal(
    play(5, ["uncertain", "uncertain", "uncertain", "uncertain", "uncertain"])
      .mastered,
    true,
  );
});

test("A later mistake discounts the correct answers that came before it", () => {
  const state = play(1, ["recalled", "recalled", "missed", "recalled"]);
  assert.equal(state.run, 1, "the run restarts after the mistake");
  assert.equal(state.recalls, 1, "the earlier recalls no longer count");
  assert.equal(state.correct, 3, "the total is never taken away");
  assert.equal(state.mastered, false);
  assert.equal(
    play(1, ["recalled", "missed", "recalled", "recalled", "recalled"])
      .mastered,
    true,
  );
});

test("A slow answer is positive evidence and a clue is not", () => {
  const slow = play(2, ["recalled", "uncertain", "recalled"]);
  assert.equal(slow.recalls, 2, "a slow correct keeps earlier recalls");
  assert.equal(slow.run, 3);
  assert.equal(slow.correct, 3);
  const clued = play(5, ["recalled", "recalled", "assisted"]);
  assert.equal(clued.run, 0, "a clue clears the run");
  assert.equal(clued.recalls, 0, "a clue clears the recalls");
  assert.equal(
    clued.correct,
    3,
    "a clued answer still counts towards the total",
  );
  assert.equal(clued.mastered, false);
  // Using the clue must never be a cheaper route to mastery than knowing the word.
  assert.equal(play(5, ["assisted", "assisted", "assisted"]).mastered, false);
  assert.equal(
    play(5, ["assisted", "assisted", "assisted", "assisted"]).mastered,
    false,
  );
  assert.equal(
    play(5, ["assisted", "assisted", "assisted", "assisted", "assisted"])
      .mastered,
    true,
    "only the cumulative floor finally retires a word nobody recalled",
  );
  assert.equal(
    play(5, ["assisted", "assisted", "assisted", "assisted"]).run,
    0,
  );
});

test("Mastery is final and the cumulative floor always empties the rotation", () => {
  const mastered = play(0, ["recalled", "recalled"]);
  const after = advanceMastery(mastered, "missed", 0);
  assert.equal(after.mastered, true, "mastery is never taken away");
  assert.equal(after.run, 0);
  assert.equal(after.correct, 2);
  // A word nobody answers cleanly still leaves the rotation after five correct.
  let stuck = initialMastery;
  for (let i = 0; i < 10; i++) {
    stuck = advanceMastery(stuck, i % 2 ? "missed" : "uncertain", 5);
    if (stuck.mastered) break;
  }
  assert.equal(
    stuck.mastered,
    true,
    "five correct answers must always retire a word",
  );
  assert.equal(stuck.correct, CUMULATIVE_FLOOR);
  // Counters never run past the display maximum.
  const many = play(
    3,
    Array.from({ length: 12 }, () => "recalled"),
  );
  assert.ok(many.run <= CUMULATIVE_FLOOR && many.recalls <= CUMULATIVE_FLOOR);
});

test("One definition of a finished word drives rotation, stats and the word list", () => {
  assert.equal(hasMastered({ mastered: true, correct: 2 }), true);
  assert.equal(
    hasMastered({ mastered: false, correct: CUMULATIVE_FLOOR }),
    true,
  );
  assert.equal(hasMastered({ mastered: false, correct: 4 }), false);
  assert.equal(hasMastered({}), false);
  assert.equal(hasMastered({ mastered: 0, correct: null }), false);
});

test("The reading budget and the child-facing rule come from the same numbers", () => {
  assert.equal(
    answerWindow(["a", "b", "c", "d"]),
    12,
    "a floor keeps tiny options fair",
  );
  assert.equal(
    answerWindow([
      "one two three four five six seven eight",
      "nine ten eleven twelve",
      "thirteen fourteen fifteen",
      "sixteen seventeen",
    ]),
    13,
  );
  assert.equal(answerWindow([Array(200).fill("word").join(" ")]), 30, "capped");
  const progress = masteryProgress(
    { correct: 1, run: 1, recalls: 1, mastered: false },
    3,
  );
  assert.equal(progress.target, 4);
  assert.equal(progress.runTarget, 5);
  assert.equal(
    describeRecallTargets(),
    "2 sure recalls for Level 0, 3 sure recalls for Levels 1–2 and 4 sure recalls for Levels 3–5",
  );
});
