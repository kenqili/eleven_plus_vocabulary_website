// The wording a child reads after every answer. It has to be true, varied, and
// specific to that child's record, so the checks are about those three things
// rather than about matching a fixed string.
import test from "node:test";
import assert from "node:assert/strict";
import { coachLine, momentFor } from "../lib/challenge/coach.ts";

/** A record for a child who has just answered, with everything spelled out. */
const answer = (over = {}) => ({
  word: "timid",
  correct: true,
  assisted: false,
  recalled: true,
  mastered: false,
  seen: 1,
  correctCount: 1,
  difficulty: 3,
  streak: 1,
  seed: "attempt-1",
  ...over,
});

test("the most specific moment wins, because it is the one worth saying", () => {
  // A word retired on this answer is a bigger thing than the streak that came
  // with it, and the streak is a bigger thing than the difficulty it was at.
  assert.equal(
    momentFor(answer({ mastered: true, streak: 9, seen: 6, correctCount: 5 })),
    "mastered",
  );
  assert.equal(momentFor(answer({ mastered: false, seen: 6, streak: 9 })), "streak");
  assert.equal(momentFor(answer({ correct: false })), "missed");
  assert.equal(momentFor(answer({ correct: false, assisted: true })), "assisted");
  // A right answer on a word the child has missed before is the useful one.
  assert.equal(momentFor(answer({ seen: 4, correctCount: 1 })), "hard-won");
});

test("a first meeting is a first meeting even on a long run", () => {
  // A brand new word is worth naming as new. Telling a child it is their ninth
  // in a row instead would be true and would miss the point.
  assert.equal(momentFor(answer({ seen: 1, streak: 8 })), "first-meeting");
});

test("spacing is named when the app knows it", () => {
  const away = coachLine(answer({ seen: 4, correctCount: 3, daysSince: 11 }));
  assert.equal(away.moment, "returning");
  assert.match(away.text, /11 days/, "says how long it was, not just that it was a while");
  // And says nothing about it when the app does not know.
  const fresh = coachLine(answer({ seen: 4, correctCount: 3, daysSince: undefined }));
  assert.notEqual(fresh.moment, "returning");
  assert.doesNotMatch(fresh.text, /days?/, "must not invent a gap it cannot see");
});

test("the same answer always says the same thing", () => {
  // Re-rendering the feedback must not swap the sentence a child is reading.
  for (const context of [
    answer({ seen: 1 }),
    answer({ seen: 5, correctCount: 2 }),
    answer({ correct: false, seen: 3 }),
    answer({ streak: 7 }),
  ]) {
    const first = coachLine(context);
    for (let again = 0; again < 5; again += 1)
      assert.equal(coachLine(context).text, first.text);
  }
});

test("every line in the pool gets used, and evenly", () => {
  // A child sees this several hundred times a term. If one sentence came out
  // twice as often as the rest it would become the sound of the app, and the
  // variation would be decorative rather than real.
  const base = answer({ seen: 3, correctCount: 2, streak: 1 });
  const seedFor = (n) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const pool = [2, 5, 8, 12].map((seen) =>
    Array.from({ length: 3000 }, (_, i) =>
      coachLine({ ...base, seen, correctCount: seen - 1, seed: seedFor(i) }).text,
    ),
  );
  for (const lines of pool) {
    const counts = new Map();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    assert.equal(
      counts.size,
      new Set(lines).size,
      "the distinct line count should be the same whichever way it is counted",
    );
    assert.ok(
      counts.size >= 2,
      `a pool of ${counts.size} was produced for one moment, so there is no variety`,
    );
    // With five options each, a fair picker lands within a few percent of even.
    const share = Math.max(...counts.values()) / lines.length;
    assert.ok(
      share < 0.3,
      `the most common line appeared ${(share * 100).toFixed(0)}% of the time`,
    );
  }
});

test("two answers in a row never say the same thing", () => {
  // A repeated sentence reads as a stuck app rather than a coincidence, and a
  // fifth of random draws collide. The caller passes the previous seed so this
  // cannot happen at all.
  const base = answer({ seen: 3, correctCount: 2, streak: 1 });
  const seedFor = (n) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const moment of [
    { seen: 1, correctCount: 1 },
    { seen: 3, correctCount: 2 },
    { seen: 9, correctCount: 6, streak: 6 },
    { seen: 3, correctCount: 0, correct: false },
    { seen: 4, correctCount: 3, daysSince: 12 },
  ]) {
    let previous;
    for (let i = 0; i < 60; i += 1) {
      const context = { ...base, ...moment, seed: seedFor(i) };
      const text = coachLine({ ...context, previousSeed: previous }).text;
      previous = context.seed;
      assert.notEqual(
        text,
        previous,
        `the same sentence twice running: "${text}" (seen ${moment.seen}, correct ${moment.correct})`,
      );
      previous = text;
    }
  }
});

test("the line never promises, and never praises ability", () => {
  // This is what the whole session has been about: an app that tells a child
  // something true. Praise of ability cannot be true of a single answer, and a
  // promise about a school cannot be true at all.
  const forbidden =
    /\b(guarantee|clever|cleverest|brilliant|genius|smart|intelligent|you will|you'll (get|pass)|better than|improving|improved|progress|gifted|talented|amazing|awesome|incredible|proud of you|well done|great job|keep it up)\b/i;
  const contexts = [];
  for (const correct of [true, false])
    for (const seen of [1, 2, 5, 9])
      for (const streak of [0, 1, 5, 12])
        for (const mastered of [false, true])
          for (const assisted of [false, true])
            contexts.push(answer({ correct, seen, streak, mastered, assisted }));
  for (const context of contexts) {
    const line = coachLine(context);
    assert.doesNotMatch(line.text, forbidden, `moment ${line.moment}: "${line.text}"`);
    assert.doesNotMatch(line.detail ?? "", forbidden, `detail: "${line.detail}"`);
  }
});

test("every number in the line is in the record it was drawn from", () => {
  // A checkable fact is the difference between encouragement a child can verify
  // and a mood. So the detail must use this word's own numbers, never the
  // session total.
  const line = coachLine(answer({ seen: 7, correctCount: 3, streak: 4, daysSince: 9 }));
  assert.ok(line.detail, "a record this specific deserves a fact");
  const numbers = (line.detail ?? "").match(/\d+/g) ?? [];
  const allowed = new Set(["7", "3", "4", "9", "0", "1", "2", "5"]);
  for (const number of numbers)
    assert.ok(allowed.has(number), `"${number}" is not in this word's record: ${line.detail}`);
});

test("a miss is never dressed up as nearly right", () => {
  for (const seen of [1, 2, 5]) {
    const line = coachLine(answer({ correct: false, seen, correctCount: 0 }));
    assert.equal(line.moment, "missed");
    // The word goes back in the list, and the app says so.
    assert.match(line.text, /\b(list|back|again|round|came back|wait)\b/i);
    // No consolation that implies the answer was close.
    assert.doesNotMatch(line.text, /\b(close|nearly|almost|so close|next time you'll)\b/i);
  }
});

test("a clued answer is named as helped, not as known", () => {
  // A child who used a clue and got it right has done something reasonable.
  // Telling them they knew it is the one thing that would make them doubt the
  // rest of the app.
  const line = coachLine(answer({ assisted: true, seen: 4, correctCount: 2 }));
  assert.equal(line.moment, "assisted");
  assert.doesNotMatch(line.text, /\b(you knew|straight out|first time through|without thinking)\b/i);
});

test("a reflex click is not reported as recall", () => {
  const recall = coachLine(answer({ recalled: true, seen: 5, correctCount: 4 }));
  const reflex = coachLine(answer({ recalled: false, seen: 5, correctCount: 4 }));
  assert.notEqual(
    recall.text,
    reflex.text,
    "a quick correct answer and a remembered one must not read the same",
  );
});

test("the word is spelled into the line, and a lowercase one is not shouted", () => {
  for (const word of ["timid", "Aught", "eclat", "OK"]) {
    const line = coachLine(answer({ word }));
    assert.ok(line.text.includes(word), `"${line.text}" does not name ${word}`);
  }
  // A capital in the middle of a sentence is left alone: the word is the word.
  const lower = coachLine(answer({ word: "timid", seen: 5, correctCount: 3 }));
  assert.doesNotMatch(lower.text, /\bTimid\b/, "a lowercase word was title-cased mid-sentence");
});

test("nothing is claimed about an unknown level", () => {
  const line = coachLine(answer({ difficulty: undefined, seen: 5, correctCount: 3 }));
  assert.doesNotMatch(line.text, /level/i);
  assert.doesNotMatch(line.detail ?? "", /Level \d of 5/, "invented a level it was not told");
});
