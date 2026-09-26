// A practical recall heuristic, not a timed test or a measure of intelligence.
export const REGULAR_MASTERY_TARGET = 5;
export const quickMasteryTarget = (level: number) => level === 0 ? 2 : level <= 2 ? 3 : 4;
export function quickAnswerWindow(choices: string[]): number {
  const readingWords = choices.join(' ').trim().split(/\s+/).length;
  return Math.min(30, Math.max(12, 8 + Math.ceil(readingWords / 4)));
}
export function isQuickRecall(seconds: number, window: number, assisted = false, wallSeconds = seconds): boolean {
  // Sub-second clicking is not convincing evidence. A restored old question
  // cannot acquire a fresh fast-answer bonus by resetting the client clock.
  return !assisted && Number.isFinite(seconds) && seconds >= 2 && seconds <= window && wallSeconds >= 2 && wallSeconds <= window + 5;
}
export function advanceMastery(prior: { correct: number; fastStreak: number; mastered: boolean }, correct: boolean, quick: boolean, level: number) {
  const count = Math.min(REGULAR_MASTERY_TARGET, prior.correct + Number(correct));
  const fastStreak = correct && quick ? prior.fastStreak + 1 : 0;
  return { correct: count, fastStreak, mastered: prior.mastered || count >= REGULAR_MASTERY_TARGET || (correct && fastStreak >= quickMasteryTarget(level)) };
}
export type MasteryProgress = { correct: number; fastStreak: number; mastered: boolean; quickTarget: number };
