// The one place word mastery is decided. Pure, isomorphic and side-effect free so the
// authoritative server path and the signed-out demo share identical rules, and so the
// numbers below can be tuned in one edit.
//
// This is a practice milestone, not a timed test and not a measure of intelligence.
// Timing only separates an unhurried answer from a reflex click; a child who has never
// heard a word will still read all four options before guessing, so speed is treated as
// supporting evidence and never as a requirement.

/** Cumulative correct answers that retire a word whatever the timing was. */
export const CUMULATIVE_FLOOR = 5;
/** Answers that showed real recall, by vocabulary level 0-5. */
export const RECALL_TARGET: readonly number[] = [2, 3, 3, 4, 4, 4];
/** Unbroken correct answers needed when the timing was not convincing. Always at least
 * one longer than RECALL_TARGET (or the cumulative floor), so evidence is never a
 * dead counter: knowing the word is always the cheapest route to mastery. */
export const RUN_TARGET: readonly number[] = RECALL_TARGET.map((target) =>
  Math.min(CUMULATIVE_FLOOR, Math.max(3, target + 1)),
);
/** Below this a click is a reflex rather than an answer. */
export const MIN_READ_SECONDS = 2;
/** How much longer than the reading window the wall clock may run. */
export const WALL_SLACK_SECONDS = 5;
/** Tolerance for clock skew between the reported and the observed time. */
export const WALL_JITTER_SECONDS = 1;

export type Evidence = "recalled" | "uncertain" | "assisted" | "missed";
export type MasteryState = {
  correct: number;
  run: number;
  recalls: number;
  mastered: boolean;
};
export type MasteryProgress = MasteryState & {
  target: number;
  runTarget: number;
};
const levelIndex = (level: number) =>
  Number.isInteger(level) && level >= 0 && level < RECALL_TARGET.length
    ? level
    : RECALL_TARGET.length - 1;
export const recallTarget = (level: number) => RECALL_TARGET[levelIndex(level)];
export const runTarget = (level: number) => RUN_TARGET[levelIndex(level)];

/** Reading budget for one question: a full read of all four options. */
export function answerWindow(choices: string[]): number {
  const readingWords = choices.join(" ").trim().split(/\s+/).length;
  return Math.min(30, Math.max(12, 8 + Math.ceil(readingWords / 4)));
}

/**
 * What one answer tells us. `seconds` must be the server-clamped time, so the verdict
 * can be reproduced from the stored attempt later.
 */
export function classify(input: {
  correct: boolean;
  revealed: boolean;
  assisted: boolean;
  seconds: number;
  wallSeconds: number;
  window: number;
}): Evidence {
  if (input.revealed || !input.correct) return "missed";
  // A clue is a deliberate admission of uncertainty: stronger evidence than any timing.
  if (input.assisted) return "assisted";
  const { seconds, wallSeconds, window } = input;
  if (!Number.isFinite(seconds) || !Number.isFinite(wallSeconds))
    return "uncertain";
  // Reported time has to fit inside real time, or a restored question can claim a
  // fresh reading budget.
  if (seconds > wallSeconds + WALL_JITTER_SECONDS) return "uncertain";
  if (seconds < MIN_READ_SECONDS || wallSeconds < MIN_READ_SECONDS)
    return "uncertain";
  if (seconds > window) return "uncertain";
  if (wallSeconds > window + WALL_SLACK_SECONDS) return "uncertain";
  return "recalled";
}

/**
 * One answer applied to one word's evidence.
 *
 * A mistake, a reveal or a clue clears both runs, so an earlier correct answer that
 * turned out to be a guess stops counting. A slow-but-correct answer is positive
 * evidence: it keeps the run and the recalls, because speed is optional here.
 */
export function advanceMastery(
  prior: MasteryState,
  evidence: Evidence,
  level: number,
): MasteryState & { newlyMastered: boolean } {
  const known = evidence === "recalled" || evidence === "uncertain";
  const run = known ? Math.min(CUMULATIVE_FLOOR, prior.run + 1) : 0;
  // A slow-but-correct answer adds no evidence and takes none away: it keeps the
  // recalls already earned, because taking your time is never penalised here.
  const recalls =
    evidence === "recalled"
      ? Math.min(CUMULATIVE_FLOOR, prior.recalls + 1)
      : evidence === "uncertain"
        ? prior.recalls
        : 0;
  const correct = Math.min(
    CUMULATIVE_FLOOR,
    prior.correct + (known || evidence === "assisted" ? 1 : 0),
  );
  const mastered =
    Boolean(prior.mastered) ||
    (evidence === "recalled" && recalls >= recallTarget(level)) ||
    run >= runTarget(level) ||
    correct >= CUMULATIVE_FLOOR;
  return {
    correct,
    run,
    recalls,
    mastered,
    newlyMastered: mastered && !prior.mastered,
  };
}

export const initialMastery: MasteryState = {
  correct: 0,
  run: 0,
  recalls: 0,
  mastered: false,
};

/** The one definition of "this word is finished", used by rotation, stats and the word list. */
export function hasMastered(progress: {
  mastered?: number | boolean | null;
  correct?: number | null;
}): boolean {
  return (
    Boolean(progress?.mastered) || (progress?.correct ?? 0) >= CUMULATIVE_FLOOR
  );
}

export const masteryProgress = (
  state: MasteryState,
  level: number,
): MasteryProgress => ({
  ...state,
  target: recallTarget(level),
  runTarget: runTarget(level),
});

/** "2 sure recalls for Level 0, 3 sure recalls for Levels 1-2 and 4 sure recalls for Levels 3-5" */
export function describeRecallTargets(): string {
  const groups: Array<{ from: number; to: number; target: number }> = [];
  RECALL_TARGET.forEach((target, level) => {
    const last = groups[groups.length - 1];
    if (last && last.target === target) last.to = level;
    else groups.push({ from: level, to: level, target });
  });
  return groups
    .map(
      ({ from, to, target }) =>
        `${target} sure recalls for ${from === to ? `Level ${from}` : `Levels ${from}–${to}`}`,
    )
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");
}
