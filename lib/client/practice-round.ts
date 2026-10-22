/**
 * The practice round, parked while the child is on another page.
 *
 * Every link in this app is a client-side route change, so leaving the practice
 * screen unmounts it without unloading the document. The engine, the question on
 * screen and the answers still waiting to be written are all still here. Rebuilding
 * them from the server on the way back costs a request, and - the larger cost -
 * replaces the question the child was in the middle of thinking about, so practice
 * appears to "reload" when all they did was look at the word list.
 *
 * One slot, not a keyed cache. There is one practice screen and one round at a
 * time; a change of filters is a different round rather than a second entry, so the
 * hook forgets the slot before it loads instead of looking a key up.
 *
 * Only a signed-in round is held. The demo is a few questions from a batch the
 * server picks, and a visitor who comes back is better served by a fresh batch than
 * by the tail of the last one.
 */
import type { QuestionType } from "@/lib/challenge/config";
import type { Difficulty } from "@/lib/challenge/difficulty";
import type { ClientBank } from "@/lib/challenge/engine";
import type {
  ChallengeState,
  Feedback,
  Question,
} from "@/lib/challenge/types";
import type { ClientSession } from "./session";

export type HeldRound = {
  state: ChallengeState;
  previous: Feedback | null;
  history: Array<{ question: Question; feedback: Feedback }>;
  historyView: number | null;
  /** Answers not yet written, so a Save button can be lit on the way back. */
  unsaved: number;
  livePlacement: { level: number; score: number } | null;
  selectedTypes: QuestionType[];
  level: Difficulty | null;
  /** The engine and the session around it: the same objects, still warm. */
  session: ClientSession;
  bank: ClientBank;
};

let held: HeldRound | null = null;

/** The parked round, if the last visit to the practice screen left one. */
export function readHeldRound(): HeldRound | null {
  return held;
}

/** Park the live round, so the next mount of the practice screen picks it up. */
export function holdRound(round: HeldRound) {
  held = round;
}

/**
 * Drop the parked round.
 *
 * Called when the round is no longer what should come back: a fresh load
 * (different filters, the words have moved) or any change of who is signed in.
 * Handing a child the round belonging to the account before theirs would be a
 * worse bug than the request this saves.
 */
export function forgetRound() {
  held = null;
}
