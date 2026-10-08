import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationFor,
  BAND_COUNT,
  currentLevel,
  drawBand,
  FAST_TRACK_ACCURACY,
  LEVEL_UP_FRACTION,
  levelFractions,
  levelScore,
  MAX_SCORE,
  narrowToBand,
  stretchFraction,
} from "../lib/challenge/placement.ts";

/** Six bands, 0–5, ~426 words each except L0's 116. */
const totals = [116, 427, 426, 426, 426, 426];
const mastered = (band, count) =>
  Array.from({ length: count }, (_, i) => ({
    level: band,
    mastered: i < count,
  }));
const correct = (level, n) =>
  Array.from({ length: n }, () => ({ level, correct: true }));
const wrong = (level, n) =>
  Array.from({ length: n }, () => ({ level, correct: false }));

test("a brand-new child starts at Level 1, not Level 0", () => {
  // L0 is the 116-word curriculum-extension set on a different axis from the
  // 1–5 frequency bands. Starting at 0 would promote out of 80%-of-116 after
  // about a day and move the level for the wrong reason — placement noise
  // presented as progress.
  assert.equal(currentLevel([0, 0, 0, 0, 0, 0], []), 1);
});

test("a firmed band moves the level with the allocation", () => {
  // The badge follows the draw: when every word in the band has been answered
  // right twice, the allocation is already asking four-fifths above, and the
  // level steps up to meet it rather than sitting a band behind.
  assert.equal(currentLevel([0, 0, 0, 0, 0, 0], [], true), 2);
  // Capped at the top: readiness cannot promote past Level 5.
  assert.equal(currentLevel([1, 1, 1, 1, 1, 1], [], true), 5);
  // And without readiness nothing changes: an unfinished band still holds.
  assert.equal(currentLevel([0, 0, 0, 0, 0, 0], []), 1);
});

test("the level follows mastered fractions upward", () => {
  const items = [
    ...mastered(0, 116),
    ...mastered(1, 342), // 342/427 = 80.1%
  ];
  const fractions = levelFractions(items, totals);
  assert.ok(fractions[1] >= LEVEL_UP_FRACTION);
  assert.equal(currentLevel(fractions, []), 2);
});

test("an unfinished band holds the level", () => {
  const items = [...mastered(0, 116), ...mastered(1, 100)];
  assert.equal(currentLevel(levelFractions(items, totals), []), 1);
});

test("one bad round never demotes", () => {
  const items = [...mastered(0, 116), ...mastered(1, 342)];
  const fractions = levelFractions(items, totals);
  // Ten wrong answers at Level 2: a bad round, not a collapse.
  assert.equal(currentLevel(fractions, wrong(2, 10)), 2);
});

test("a sustained collapse demotes exactly one level", () => {
  const items = [...mastered(0, 116), ...mastered(1, 342)];
  const fractions = levelFractions(items, totals);
  const trailing = [...wrong(2, 29), { level: 2, correct: true }];
  assert.equal(currentLevel(fractions, trailing), 1);
  // And the floor holds a single step: collapsing at Level 1 lands on 0, not
  // below it — and 0 is a real band, the curriculum-extension set, not a pit.
  const early = levelFractions(mastered(1, 100), totals);
  assert.equal(currentLevel(early, wrong(1, 30)), 0);
});

test("a fast run promotes a misplaced child early", () => {
  // Ninety percent over twenty four-option questions cannot happen by guessing,
  // so a child answering at this rate is placed too low and waiting for 80% of
  // ~426 words would waste weeks of their time.
  const items = [...mastered(1, 50)];
  assert.equal(currentLevel(levelFractions(items, totals), correct(1, 20)), 2);
});

test("a fast run below the bar changes nothing", () => {
  const items = [...mastered(1, 50)];
  const trailing = [...correct(1, 17), ...wrong(1, 3)]; // 85%
  assert.ok(
    17 / 20 < FAST_TRACK_ACCURACY,
    "the fixture does not test what it claims",
  );
  assert.equal(currentLevel(levelFractions(items, totals), trailing), 1);
});

test("clue-assisted answers do not fast-track", () => {
  // The TrailingAnswer contract counts assisted answers as not-correct, the
  // same way they do not count toward mastery. A child leaning on the clue
  // must not promote: this pins the contract from the caller's side.
  const items = [...mastered(1, 50)];
  const trailing = Array.from({ length: 20 }, () => ({
    level: 1,
    correct: false,
  }));
  assert.equal(currentLevel(levelFractions(items, totals), trailing), 1);
});

test("the score fills each sixth of 10,000 monotonically", () => {
  assert.equal(levelScore(0, 0), 0);
  assert.equal(levelScore(5, 1), MAX_SCORE);
  // Each band is worth the same slice, whatever its word count: L0's 116 words
  // are not worth less than L1's 427. And bands join without a jump: the top
  // of one band is the bottom of the next, so levelling up never skips the
  // number in between.
  assert.equal(levelScore(1, 0), levelScore(0, 1));
  let last = -1;
  for (let level = 0; level < BAND_COUNT; level++) {
    let bandLast = -1;
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const score = levelScore(level, fraction);
      assert.ok(score >= last, `score runs backward at L${level}/${fraction}`);
      assert.ok(
        score > bandLast,
        `score stalls inside L${level} at ${fraction}`,
      );
      last = score;
      bandLast = score;
    }
  }
  // One mastered word in a 426-word band moves the number: the score is alive
  // long before the level changes, which is what keeps a child going through
  // the slow middle of a band.
  assert.ok(levelScore(1, 1 / 426) > levelScore(1, 0));
});

test("allocation never reaches beyond one band away", () => {
  for (let level = 0; level < BAND_COUNT; level++) {
    for (const stretch of [0, 0.5, 1]) {
      for (const band of allocationFor(level, stretch).keys()) {
        assert.ok(
          Math.abs(band - level) <= 1,
          `L${level} allocates to L${band}: a Level 1 child must never draw Level 4 or 5`,
        );
      }
      const total = [...allocationFor(level, stretch).values()].reduce(
        (a, b) => a + b,
        0,
      );
      assert.ok(
        Math.abs(total - 1) < 1e-9,
        `L${level} weights sum to ${total}`,
      );
    }
  }
  // The top band revises downward instead of reaching for a band that does not
  // exist; the bottom band keeps everything at home until it opens upward.
  assert.ok(!allocationFor(5, 1).has(6));
  assert.equal(allocationFor(0, 0).get(0), 1);
  assert.equal(allocationFor(0, 0).get(1), undefined);
});

test("the stretch above opens with twice-right answers, never before", () => {
  // Fresh band: revision below, everything else at home, nothing above. This
  // is the complaint that started it - a child on their first morning met a
  // Level 2 word every fifth question.
  assert.deepEqual(
    [...allocationFor(1, 0)],
    [
      [0, 0.2],
      [1, 0.8],
    ],
  );
  // Half the band answered right twice: the next band holds a third of the
  // round.
  assert.deepEqual(
    [...allocationFor(1, 0.5)],
    [
      [0, 0.2],
      [1, 0.4],
      [2, 0.4],
    ],
  );
  // The whole band ready: the current band yields entirely, and the 80% the
  // next band holds is what practising there looks like before the level
  // itself moves.
  assert.deepEqual(
    [...allocationFor(1, 1)],
    [
      [0, 0.2],
      [1, 0],
      [2, 0.8],
    ],
  );
  // The top band has nowhere to open into, whatever the fraction says.
  assert.deepEqual(
    [...allocationFor(5, 1)],
    [
      [4, 0.2],
      [5, 0.8],
    ],
  );
});

test("readiness counts twice-right words in the band", () => {
  const items = [
    { level: 1, correct: 0 },
    { level: 1, correct: 1 },
    { level: 1, correct: 2 },
    { level: 1, correct: 5 },
    { level: 2, correct: 9 },
  ];
  // Two of four band-1 words are twice-right; band 2's words do not count
  // towards band 1's opening, however right they are.
  assert.equal(stretchFraction(items, [0, 4, 1, 0, 0, 0], 1), 0.5);
  // One right answer is meeting, not firming: it opens nothing.
  assert.equal(
    stretchFraction([{ level: 1, correct: 1 }], [0, 1, 0, 0, 0, 0], 1),
    0,
  );
  // An empty band reads complete: with nothing to learn there, there is
  // nothing to wait for before looking ahead.
  assert.equal(stretchFraction([], [0, 0, 0, 0, 0, 0], 3), 1);
});

test("an exhausted band yields to its neighbours", () => {
  const weights = allocationFor(1, 0.5); // 0: .2, 1: .4, 2: .4
  // Band 1 fully mastered: the draw renormalises over 0 and 2 rather than
  // returning nothing or repeating mastered words.
  const seen = new Set();
  for (let i = 0; i < 200; i++)
    seen.add(drawBand(weights, new Set([0, 2]), () => i / 200));
  assert.deepEqual([...seen].sort(), [0, 2]);
  assert.equal(drawBand(weights, new Set(), Math.random), null);
});

test("narrowing keeps due-bypass callers honest", () => {
  // The shared second stage both question paths call. `bandOf` is a parameter
  // because the engine reads difficulty off its rows while the server resolves
  // it through the bank — same bands, different shelves.
  const words = [
    { id: "a", level: 1 },
    { id: "b", level: 1 },
    { id: "c", level: 2 },
  ];
  const bandOf = (word) => word.level;
  // Deterministic draws: a roll of 0 lands the first weighted band.
  const first = narrowToBand(words, bandOf, allocationFor(1), () => 0);
  assert.deepEqual(
    first.words.map((w) => w.id),
    ["a", "b"],
    "the draw must narrow to the drawn band",
  );
  // A drawn band with nothing to ask leaves the full set: an exhausted band
  // yields to its neighbours, never stalls practice.
  const missing = narrowToBand(
    [{ id: "z", level: 1 }],
    bandOf,
    new Map([[5, 1]]),
    () => 0.5,
  );
  assert.equal(missing.band, null);
  assert.deepEqual(
    missing.words.map((w) => w.id),
    ["z"],
  );
  // Nothing available at all: null band, empty set — the caller already
  // handles "nothing to ask".
  const empty = narrowToBand([], bandOf, allocationFor(1), () => 0.5);
  assert.equal(empty.band, null);
  assert.deepEqual(empty.words, []);
  // Out-of-range bands never enter the draw, so corrupt data cannot promote a
  // word into a band the weights do not know.
  const odd = narrowToBand(
    [{ id: "q", level: 9 }],
    bandOf,
    allocationFor(1),
    () => 0.5,
  );
  assert.equal(odd.band, null);
  assert.deepEqual(
    odd.words.map((w) => w.id),
    ["q"],
  );
});

test("empty bands never pin the level down", () => {
  // A band with no words in the pool (all excluded) reads complete, so there
  // is nothing to wait for there.
  assert.deepEqual(levelFractions([], [0, 0, 0, 0, 0, 0]), [1, 1, 1, 1, 1, 1]);
});

test("fractions ignore out-of-range bands", () => {
  const fractions = levelFractions(
    [
      { level: 1, mastered: true },
      { level: 9, mastered: true },
      { level: -1, mastered: true },
    ],
    totals,
  );
  assert.equal(fractions[1], 1 / 427);
});
