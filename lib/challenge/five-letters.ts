import accepted from "../../data/five-letters/accepted.json" with { type: "json" };
import { CUMULATIVE_FLOOR } from "./mastery.ts";
import {
  COUNTED_CORRECT,
  placementFromBands,
  STRETCH_CORRECT,
  type BandSummary,
  type TrailingAnswer,
} from "./placement.ts";

/**
 * Pure Five Letters rules, shared by the server and the browser.
 *
 * Nothing here reads a database or imports the word bank. The accepted list is
 * imported so the browser can reject an unknown word without a round trip; the
 * curated answers stay on the server, and the dictionary is a separate asset the
 * guest fetches lazily. That split is what keeps the whole 2,247-word bank out of
 * a child's game bundle.
 */

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
/** Points one hint removes from the displayed 10,000 score. */
export const HINT_SCORE_PENALTY = 5;

export type FiveLettersMark = "green" | "yellow" | "grey";
export type FiveLettersHintKind = "syn" | "ant";
export type FiveLettersStatus = "playing" | "solved" | "revealed";

export type FiveLettersCard = {
  definition: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
  source: "MineWords" | "WordNet 3.0" | "Game list";
  /** For an inflected form, the base WordNet or bank word it came from. */
  base?: string;
};

export type FiveLettersGuess = {
  word: string;
  marks: FiveLettersMark[];
  card: FiveLettersCard;
  /** True only when this guess was a bank word in the child's collection. */
  counted: boolean;
  /** The word's correctness count after this guess; 0 when not counted. */
  correct: number;
  /** True only when this guess's count finished the word. */
  mastered: boolean;
};

export type FiveLettersAnswer = {
  word: string;
  card: FiveLettersCard;
  /** The solve set the mastered flag; false for a reveal or an already-known word. */
  newlyMastered: boolean;
  /** The word was already mastered before this round ended. */
  alreadyMastered: boolean;
};

export type FiveLettersGame = {
  id: string;
  guesses: FiveLettersGuess[];
  hints: FiveLettersHintKind[];
  /** The relation shown for each hint kind used this round. */
  hintText: Partial<Record<FiveLettersHintKind, string>>;
  remainingGuesses: number;
  remainingHints: FiveLettersHintKind[];
  status: FiveLettersStatus;
  /** Present only once the round is solved or revealed. */
  answer?: FiveLettersAnswer;
};

export type FiveLettersState = {
  game: FiveLettersGame | null;
  /** The displayed 10,000 score, already reduced by the account penalty. */
  score: number;
  /** The permanent account-level deduction from hints. */
  scorePenalty: number;
  freeTier: boolean;
  freeWordCount: number;
  /**
   * What the browser needs to run the round without asking again.
   *
   * Present only while the round is playing. It carries the answer, because a
   * guess is marked in the browser and marking needs the answer; and the
   * account's knowledge, counted band by band, because the score has to keep
   * right while the child plays. The round ends in one request, and the server
   * works out the marks itself from the words the browser reports.
   */
  round?: FiveLettersRound;
  /** A repeated guess or hint, answered with the unchanged state. */
  duplicate?: boolean;
};

/**
 * The words a guess can count toward the account's knowledge, one tuple each.
 *
 * Only the bank's five-letter words can count, and there are fewer than two
 * hundred of them, so this is small: the word, its band, how many right
 * answers it holds, and whether it is already mastered. A browser that has
 * these can work out what a guess is worth without asking the server.
 */
export type FiveLettersCountable = [
  wordId: string,
  band: number,
  correct: number,
  mastered: boolean,
];

/**
 * Everything a round needs to run in the browser.
 *
 * The answer is here so the browser can mark a guess, and the account's
 * knowledge is here so the score can keep right. The server still decides
 * what a guess is worth when the round ends: it re-marks the words the browser
 * reports and works the credit out from the database.
 */
export type FiveLettersRound = {
  /** The answer, so a guess can be marked in the browser. */
  answer: string;
  /** The relation each hint kind would show, so a hint costs no round trip. */
  hints: Partial<Record<FiveLettersHintKind, string>>;
  /** The account's knowledge, counted band by band. */
  bands: BandSummary[];
  /** The last thirty answers, which the level estimate reads. */
  trailing: TrailingAnswer[];
  /** The permanent deduction the account's hints have already cost it. */
  penalty: number;
  /** The words a guess can count, and the state the score needs. */
  answers: FiveLettersCountable[];
};

export type FiveLettersAction =
  | { action: "start" }
  | { action: "next" }
  | {
      action: "finish";
      gameId: string;
      /** The words guessed, in the order they were guessed. */
      guesses: string[];
      /** The hint kinds taken. */
      hints: FiveLettersHintKind[];
      /** How the round ended. */
      status: "solved" | "revealed";
    };

/**
 * The account's knowledge, kept in the browser while a round is played.
 *
 * The server sends it counted band by band. A guess that counts moves one
 * word's right answers up; a solve moves the answer into the mastered column;
 * a hint takes five points off for good. All three are counted here, and the
 * same shared functions the server uses turn the counts into the number on the
 * screen, so the score the child watches move is the score the server will
 * work out at the end of the round.
 */
export type FiveLettersScore = {
  bands: BandSummary[];
  trailing: TrailingAnswer[];
  /** What the account's hints have cost it for good. */
  penalty: number;
  /** The words a guess can count, and the state each one is in. */
  words: Map<string, { band: number; correct: number; mastered: boolean }>;
};

/** The account's knowledge, from the round the server sent. */
export function scoreFromRound(round: FiveLettersRound): FiveLettersScore {
  return {
    bands: round.bands.map((band) => ({ ...band })),
    trailing: round.trailing,
    penalty: round.penalty,
    words: new Map(
      round.answers.map(([wordId, band, correct, mastered]) => [
        wordId,
        { band, correct, mastered },
      ]),
    ),
  };
}

/** The number on the screen: the placement, less what the hints have cost. */
export function scoreOf(score: FiveLettersScore): number {
  const { score: placed } = placementFromBands(score.bands, score.trailing);
  return scoreAfterPenalty(placed, score.penalty);
}

/**
 * A guess that counted: one more right answer for that word.
 *
 * The credit a word is worth is capped, so a word that is already worth the
 * most adds nothing, and the count that opens the band above is counted once,
 * when the word reaches it.
 */
export function countGuess(score: FiveLettersScore, wordId: string): void {
  const word = score.words.get(wordId);
  const band = word ? score.bands[word.band] : undefined;
  if (!word || !band) return;
  const prior = word.correct;
  word.correct = Math.min(CUMULATIVE_FLOOR, prior + 1);
  band.credit +=
    Math.min(COUNTED_CORRECT, word.correct) -
    Math.min(COUNTED_CORRECT, prior);
  if (prior < STRETCH_CORRECT && word.correct >= STRETCH_CORRECT) {
    band.ready += 1;
  }
}

/** The answer was found: the word is mastered, and the band knows it. */
export function masterWord(score: FiveLettersScore, wordId: string): void {
  const word = score.words.get(wordId);
  if (!word || word.mastered) return;
  word.mastered = true;
  const band = score.bands[word.band];
  if (band) band.mastered += 1;
}

const ACCEPTED = new Set(accepted);
const FIVE_LETTERS = /^[a-z]{5}$/;

/** Lower-case and validate a typed guess, without deciding whether it is accepted. */
export function normalizeGuess(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const word = raw.trim().toLowerCase();
  return FIVE_LETTERS.test(word) ? word : null;
}

export function isAcceptedGuess(word: string): boolean {
  return FIVE_LETTERS.test(word) && ACCEPTED.has(word);
}

/**
 * Standard Wordle marking, in two passes.
 *
 * Greens are taken first and their answer letters removed from the pool. The
 * remaining positions then take a yellow only while an unmatched copy of the
 * letter remains, which is why BBBBB against ABBEY marks two Bs green and three
 * grey rather than five green.
 */
export function gradeGuess(answer: string, guess: string): FiveLettersMark[] {
  if (!FIVE_LETTERS.test(answer) || !FIVE_LETTERS.test(guess))
    throw new Error("Five Letters needs two five-letter words.");
  const marks: FiveLettersMark[] = Array(WORD_LENGTH).fill("grey");
  const remaining = new Map<string, number>();
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (answer[i] === guess[i]) marks[i] = "green";
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (marks[i] === "green") continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = "yellow";
      remaining.set(guess[i], left - 1);
    }
  }
  return marks;
}

const MARK_RANK: Record<FiveLettersMark, number> = {
  green: 3,
  yellow: 2,
  grey: 1,
};

/**
 * The best mark seen for each letter, for the on-screen keyboard.
 *
 * A green result outranks a yellow one, and either outranks grey, so a letter
 * never loses a known place because a later guess used all its copies. Keys are
 * uppercase to match the on-screen keyboard, while guesses are lowercase.
 */
export function keyboardMarks(
  guesses: ReadonlyArray<{
    word: string;
    marks: readonly FiveLettersMark[];
  }>,
): Partial<Record<string, FiveLettersMark>> {
  const marks: Partial<Record<string, FiveLettersMark>> = {};
  for (const guess of guesses) {
    for (let index = 0; index < guess.word.length; index += 1) {
      const letter = guess.word[index]?.toUpperCase();
      const mark = guess.marks[index];
      if (!letter || !mark) continue;
      const current = marks[letter];
      if (!current || MARK_RANK[mark] > MARK_RANK[current]) {
        marks[letter] = mark;
      }
    }
  }
  return marks;
}

export function usedHintKinds(hints: string): FiveLettersHintKind[] {
  return hints
    .split(",")
    .map((part) => part.trim())
    .filter(
      (part): part is FiveLettersHintKind => part === "syn" || part === "ant",
    );
}

/**
 * The one relation shown for a hint kind.
 *
 * Deterministic on purpose: a used hint has to read the same after a reload,
 * and a retried request has to be free and identical. The bank's relations are
 * already curated in a sensible order, so the first usable one is the hint.
 */
export function hintFor(
  card: FiveLettersCard,
  kind: FiveLettersHintKind,
  answer: string,
): string | null {
  const values = kind === "syn" ? card.synonyms : card.antonyms;
  const secret = answer.toLowerCase();
  const found = values.find((value) => {
    const clean = value.trim().toLowerCase();
    return clean && clean !== secret;
  });
  return found?.trim() ?? null;
}

export function availableHintKinds(
  card: FiveLettersCard,
  answer: string,
): FiveLettersHintKind[] {
  return (["syn", "ant"] as const).filter(
    (kind) => hintFor(card, kind, answer) !== null,
  );
}

export function remainingHintKinds(
  card: FiveLettersCard,
  answer: string,
  hints: string,
): FiveLettersHintKind[] {
  const used = new Set(usedHintKinds(hints));
  return availableHintKinds(card, answer).filter((kind) => !used.has(kind));
}

/** The score as a child sees it: never below zero, whatever the stored penalty. */
export function scoreAfterPenalty(score: number, penalty: number): number {
  return Math.max(0, Math.floor(score) - Math.max(0, Math.floor(penalty)));
}
