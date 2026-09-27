/**
 * What the app says after an answer, worked out from what the child actually
 * did.
 *
 * A vocabulary app already holds the one thing that makes feedback worth
 * reading: it knows whether this child has met this word before, how many
 * times they have been right, how long it has been since they last saw it, and
 * whether the answer was recall or a lucky click. Generic praise throws that
 * away. "Nice one, six in a row!" says nothing about the child, and a child
 * sees it four hundred times a term.
 *
 * So the lines here are specific to the record and vary from answer to answer.
 * Two properties are deliberate and tested:
 *
 * Nothing is claimed that the app cannot check. There is no praise of ability,
 * no prediction, and no number that is not in the record it was drawn from. A
 * child who is told they did well deserves to be able to work out why.
 *
 * A miss is never dressed up. It says what happened, says the word will come
 * back, and stops. No encouragement that implies the answer was nearly right,
 * because it might not have been, and a child who catches that stops believing
 * the rest of it.
 */

/** How well the child actually did, not merely whether they were right. */
export type CoachContext = {
  /** False for a wrong answer or a reveal. */
  correct: boolean;
  /** The child asked for the clue. */
  assisted: boolean;
  /** Genuine recall, as opposed to a reflex click inside the reading window. */
  recalled: boolean;
  /** This word has now been retired. */
  mastered: boolean;
  /** How many times this child has been shown this word, counting now. */
  seen: number;
  /** How many of those they got right, counting now. */
  correctCount: number;
  /** Vocabulary level 0 to 5, if known. */
  difficulty?: number;
  /** Unbroken run of right answers. */
  streak: number;
  /** Days since this word was last shown, if it has been shown before. */
  daysSince?: number;
  /** The word as the child should read it, already capitalised where it starts a sentence. */
  word: string;
  /** Stable per answer, so one answer always says the same thing. */
  seed: string;
  /**
   * The seed used for the previous answer, so this one can avoid repeating it.
   *
   * Optional, because two answers drawn at random from a pool of five land on
   * the same sentence a fifth of the time, which means a child would regularly
   * be told the same thing twice running. It reads as a stuck app rather than a
   * coincidence, and it is worth a second seed rather than an apology.
   */
  previousSeed?: string;
};

export type CoachMoment =
  | "first-meeting"
  | "mastered"
  | "returning"
  | "hard-won"
  | "clean-recall"
  | "streak"
  | "assisted"
  | "steady"
  | "missed"
  | "revealed";

export type CoachLine = {
  moment: CoachMoment;
  /** The line itself, in the child's terms. */
  text: string;
  /**
   * A fact from the child's own record on this word, shown beside the line. It
   * is there so the encouragement is checkable rather than decorative.
   */
  detail?: string;
};

/**
 * A stable pick from a list.
 *
 * Stable because the same answer must not say two different things when a
 * component re-renders, and varied because the fourth identical sentence in a
 * row is noise that trains a child to stop reading.
 */
function pick<T>(options: readonly T[], seed: string, salt = ""): T {
  let hash = 2166136261;
  for (const character of seed + salt) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  // FNV-1a leaves the low bits poorly distributed for short similar inputs such
  // as consecutive attempt ids, and it is the low bits that a modulo uses. One
  // round mixing spreads them, which is what stops three identical sentences in
  // a row across a pool of five.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return options[Math.abs(hash) % options.length];
}

const numberWord = (value: number) => {
  const words = [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  if (value < words.length) return words[value];
  return value < 20 ? `${value}` : `${value}`;
};

/** The level names the app already shows, so the app does not use two sets. */
const LEVELS = [
  "the easiest words",
  "a slightly trickier word",
  "a middle word",
  "a harder word",
  "one of the harder words",
  "the hardest words",
];

const levelName = (difficulty: number | undefined) =>
  difficulty !== undefined &&
  Number.isInteger(difficulty) &&
  difficulty >= 0 &&
  difficulty < LEVELS.length
    ? LEVELS[difficulty]
    : null;

/** The level as a number, for the checkable detail line. */
const levelNumber = (difficulty: number | undefined) =>
  difficulty !== undefined && Number.isInteger(difficulty) && difficulty >= 0
    ? Math.min(difficulty, 5)
    : 0;

/**
 * Which moment this answer was. Ordered most specific first, because a word
 * retired on this answer is the thing worth saying, not the fact that it was
 * also the child's sixth in a row.
 */
export function momentFor(context: CoachContext): CoachMoment {
  if (context.mastered) return "mastered";
  if (!context.correct) return context.assisted ? "assisted" : "missed";
  if (context.assisted) return "assisted";
  if (context.seen <= 1) return "first-meeting";
  if (context.streak >= 5) return "streak";
  if (context.daysSince !== undefined && context.daysSince >= 7)
    return "returning";
  // Right, but not on the first or second try: the word was already known to
  // be shaky, so this is the useful one.
  if (context.seen > context.correctCount + 1) return "hard-won";
  if (context.recalled) return "clean-recall";
  return "steady";
}

const LINES: Record<CoachMoment, readonly string[]> = {
  "first-meeting": [
    "First time you have seen {word}. Now you have.",
    "{Word} is new to you. That is fine, it is in the collection now.",
    "A new one: {word}. It will come back.",
    "{Word}, and this is the first look. Take your time.",
    "First meeting with {word}. Worth remembering.",
    "This is your first go at {word}.",
  ],
  mastered: [
    "{Word} is yours. It has left your list.",
    "That is {word} properly learned. It is off your list.",
    "{Word} finished. It was work, and it is done.",
    "{Word} done and dusted. Off your list.",
    "{Word} settled. It will not be asked again.",
  ],
  returning: [
    "You last saw {word} {days} days ago and it stayed.",
    "{Word} came back after {days} days and you had it.",
    "This is {word}, last time {days} days back. Still there.",
    "Back to {word} after {days} days. Straight away.",
  ],
  "hard-won": [
    "You have missed {word} before. This time you had it.",
    "{Word} was a tricky one. You have it now.",
    "Second time lucky with {word}, and this time it stuck.",
    "You had to work for {word}. Worth it.",
    "{Word} again, and that one has been in your list since the start.",
  ],
  "clean-recall": [
    "{Word}, straight out.",
    "You had {word} straight away.",
    "No hesitation on {word}.",
    "{Word}, first time through.",
    "That one was already yours: {word}.",
  ],
  streak: [
    "That is {streak} in a row.",
    "{streak} right, one after another.",
    "You are on {streak} now.",
    "{streak} without a miss.",
    "Run of {streak}. That is something.",
  ],
  assisted: [
    "You asked for the clue, and you still got it. That counts.",
    "You worked it out with a clue. That is what a clue is for.",
    "The clue helped you find {word}. Good use of it.",
    "You needed a nudge for {word}. It is now in your list.",
  ],
  steady: [
    "You know {word}.",
    "That is {word} again, right.",
    "{Word}, good.",
    "You have got {word}.",
    "Right again.",
  ],
  missed: [
    "Not this time. {Word} is in your list again now.",
    "{Word} did not stick. It will come back.",
    "That one got away. {Word} is coming back round.",
    "Wrong, and that is allowed. {Word} will wait for you.",
    "{Word} again shortly, so it can settle.",
  ],
  revealed: [
    "Here is {word}. It is in your list now.",
    "Now you have seen {word}. It will come back.",
    "{Word}, revealed. It goes in your list.",
  ],
};

/** The line, with the word filled in. */
export function coachLine(context: CoachContext): CoachLine {
  const moment = momentFor(context);
  const pool = LINES[moment];
  let template = pick(pool, context.seed, moment);
  // One re-roll is enough: it removes the immediate repeat, and taking the next
  // line in the list rather than picking again keeps this a pure function with
  // no state and no loop.
  if (
    context.previousSeed !== undefined &&
    pool.length > 1 &&
    pick(pool, context.previousSeed, moment) === template
  )
    template = pool[(pool.indexOf(template) + 1) % pool.length];
  const name = context.word;
  const text = template
    .replace(/\{word\}/g, name)
    .replace(/\{Word\}/g, name.charAt(0).toUpperCase() + name.slice(1))
    .replace(/\{days\}/g, String(context.daysSince ?? 0))
    .replace(/\{streak\}/g, numberWord(context.streak));
  return { moment, text, detail: coachDetail(context, moment) };
}

/**
 * A checkable fact from this child's record on this word. Shown beside the
 * line so the encouragement is a statement of fact rather than a mood.
 */
function coachDetail(
  context: CoachContext,
  moment: CoachMoment,
): string | undefined {
  if (moment === "first-meeting")
    return `Level ${levelNumber(context.difficulty)} of 5 · new to you`;
  if (moment === "mastered")
    return `You met ${context.word} ${numberWord(context.seen)} times before it stuck.`;
  if (moment === "returning" && context.daysSince !== undefined)
    return `Seen ${numberWord(context.seen)} times · last one ${context.daysSince} days ago`;
  if (moment === "hard-won")
    return `Seen ${numberWord(context.seen)} times · right ${numberWord(context.correctCount)} of them`;
  if (moment === "streak")
    return `${context.streak} in a row · ${numberWord(context.correctCount)} of ${numberWord(context.seen)} on ${context.word}`;
  if (moment === "assisted" && context.seen > 1)
    return `${numberWord(context.correctCount)} of ${numberWord(context.seen)} right without help`;
  if (moment === "missed" && context.seen > 1)
    return `Right ${numberWord(context.correctCount)} of ${numberWord(context.seen)} times so far`;
  if (levelName(context.difficulty) && moment === "steady")
    return `${levelName(context.difficulty)} · right ${numberWord(context.correctCount)} of ${numberWord(context.seen)}`;
  return undefined;
}
