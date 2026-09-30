/**
 * The credit rules, as pure functions.
 *
 * These used to live only in a SQL trigger. That worked, and it was the reason
 * credits were the one thing the browser could not reproduce: the trigger read
 * and wrote the wallet, so the balance changed on the database and the client
 * had no way to know what it would be. An estimate is not good enough here -
 * credits buy badges and a parent reads the number - so the rules move into
 * TypeScript, where both sides can run them and a test can check they agree.
 *
 * The arithmetic is copied from `learning_awards` (drizzle/0003) exactly, and the
 * order matters: the streak is incremented *before* the award is worked out, so
 * the every-third bonus counts the answer that earned it. That ordering is the
 * easiest thing to get subtly wrong, so `tests/rewards.test.mjs` still drives both
 * and compares.
 *
 * What the trigger cannot be: it has no idea which words a child has already met,
 * so it cannot tell a first meeting from a repeat without a count. That comes from
 * the client, which has been counting all along.
 */

/** Credits for one answer. */
export type Award = {
  /** Paid for answering correctly, when the answer counted. */
  base: number;
  /** Paid on every third consecutive counted correct answer. */
  streak: number;
  /** Paid for the answer that finished a word. */
  mastery: number;
  /** The running streak after this answer. */
  streakAfter: number;
  total: number;
};

export type AnswerForAward = {
  /** The child got it right. An assisted answer is right but not counted. */
  correct: boolean;
  /**
   * Whether it counted towards credits and the streak.
   *
   * This is not the same as `correct`. A word that has already been credited five
   * times is still answerable and still right, but paying again is how credits
   * get farmed, so eligibility is capped - and an assisted answer is right without
   * counting. The two together are what the SQL keyed eligibility on.
   */
  eligible: boolean;
  /** This answer finished the word. */
  mastered: boolean;
};

export const BASE_CREDITS = 2;
export const STREAK_BONUS = 5;
/** Every third consecutive counted correct answer. */
export const STREAK_EVERY = 3;
export const MASTERY_CREDITS = 10;
/** A word stops paying after this many counted correct answers. */
export const ELIGIBLE_ANSWERS = 5;

/** The streak before this answer. */
export function awardFor(answer: AnswerForAward, streakBefore: number): Award {
  // The trigger clears the streak on a wrong answer and leaves it alone on an
  // uncounted one, which is why an assisted answer neither breaks nor advances
  // it.
  const streakAfter = !answer.correct
    ? 0
    : answer.eligible
      ? streakBefore + 1
      : streakBefore;
  const counts = answer.correct && answer.eligible;
  const base = counts ? BASE_CREDITS : 0;
  // The bonus reads the streak *after* the increment, so the answer that makes
  // three is the one that pays.
  const streak = counts && streakAfter % STREAK_EVERY === 0 ? STREAK_BONUS : 0;
  const mastery = answer.mastered ? MASTERY_CREDITS : 0;
  return { base, streak, mastery, streakAfter, total: base + streak + mastery };
}

/**
 * A ledger entry for an award.
 *
 * The trigger only wrote a row when something was actually paid, so a run of
 * wrong answers does not fill the ledger with zeroes. Worth keeping: it is what
 * a parent reads when they ask where the credits came from.
 */
export const paid = (award: Award) => award.total > 0;
