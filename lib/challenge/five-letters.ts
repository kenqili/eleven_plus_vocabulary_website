import accepted from "../../data/five-letters/accepted.json" with { type: "json" };

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
  /** A repeated guess or hint, answered with the unchanged state. */
  duplicate?: boolean;
};

export type FiveLettersAction =
  | { action: "start" }
  | { action: "next" }
  | { action: "guess"; gameId: string; guess: string }
  | { action: "hint"; gameId: string; kind: FiveLettersHintKind }
  | { action: "reveal"; gameId: string };

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
