import { levelOf, wordById, words } from "@/lib/challenge/bank";
import {
  buildQuestions,
  gradeSelection,
  QUESTIONS_PER_MATCH,
  relationAnswers,
  RELATION_KINDS,
  type RelationFinish,
  type RelationKind,
  type RelationMatch,
  type RelationQuestion,
  type RelationResult,
} from "@/lib/challenge/relations";
import { freeWordIds } from "./free-words";
import { HttpError } from "./http";
import { historyFor, recordGameMatch } from "./game-match";
import { placementForPool } from "./placement";

/**
 * The relation challenge's questions, and the level they are drawn from.
 *
 * A match runs in the browser: the questions are built on the server and sent
 * with the page, the child's picks are marked where the child is looking, and
 * the whole match is written down once at the end. The server does not take the
 * browser's word for what was right - it recomputes the answer set from the bank
 * for every word reported - so a tampered client can claim a score, but it
 * cannot claim a correctness.
 */

export type RelationState = {
  kind: RelationKind;
  questions: RelationQuestion[];
  history: RelationMatch[];
  /**
   * The band the questions were drawn from, when there were enough words in it
   * to fill a match. Null when the pool was widened to every allowed word, so
   * the page never claims an alignment it did not make.
   */
  level: number | null;
};

export function relationKind(value: unknown): RelationKind {
  if (
    typeof value === "string" &&
    (RELATION_KINDS as readonly string[]).includes(value)
  )
    return value as RelationKind;
  throw new HttpError(400, "Choose a synonym or an antonym challenge.");
}

/** The questions a signed-out visitor plays. The free collection, no history. */
export function guestQuestions(kind: RelationKind): RelationQuestion[] {
  const allowed = freeWordIds();
  const targets = words.filter(
    (word) =>
      allowed.has(word.id) && relationAnswers(word, kind).length > 0,
  );
  return buildQuestions({ kind, targets, vocabulary: words });
}

export async function startRelationGame(
  userId: string,
  kind: RelationKind,
  allowedWordIds: ReadonlySet<string> | undefined,
  includeMastered: boolean,
): Promise<RelationState> {
  const targets = words.filter(
    (word) =>
      (!allowedWordIds || allowedWordIds.has(word.id)) &&
      relationAnswers(word, kind).length > 0,
  );
  if (!targets.length)
    throw new HttpError(
      402,
      "Your free collection is disabled. Subscribe to continue playing.",
    );

  // Mastered words are left out by default: a game that keeps asking words the
  // child already knows is a game that stops teaching. Review mode puts them
  // back, because a child who wants to play the familiar words should be able
  // to. The level is counted over the whole pool either way, so turning review
  // on does not move the band.
  const { level, mastered } = await placementForPool(userId, targets);
  const playable = includeMastered
    ? targets
    : targets.filter((word) => !mastered.has(word.id));
  if (!playable.length)
    throw new HttpError(
      402,
      "Every word here is mastered. Turn on review mode to play them again.",
    );

  // Align the questions with where the child is. The band is drawn from the
  // same placement the practice screen shows; if it cannot fill a match - a
  // free account whose collection has no words at that band, say - the whole
  // playable pool is used and the page is told there is no level to show.
  const inBand = playable.filter((word) => levelOf.get(word.id) === level);
  const aligned = inBand.length >= QUESTIONS_PER_MATCH;
  const questions = buildQuestions({
    kind,
    targets: aligned ? inBand : playable,
    vocabulary: words,
  });
  if (!questions.length)
    throw new HttpError(402, "There are no words to play with yet.");
  return {
    kind,
    questions,
    history: await historyFor(userId, kind),
    level: aligned ? level : null,
  };
}

/**
 * Record a finished match.
 *
 * `submitted` is the browser's report of what it picked, not what it scored.
 * Every word is looked up again, every selection is graded against the bank,
 * and only the words that were answered exactly right get a correctness. A
 * word repeated inside one match counts once, so a client cannot send the same
 * easy word ten times and finish it in a sitting.
 */
export async function finishRelationMatch(
  userId: string,
  kind: RelationKind,
  matchId: string,
  submitted: readonly unknown[],
  seconds: unknown,
  allowedWordIds: ReadonlySet<string> | undefined,
): Promise<RelationFinish> {
  const graded: RelationResult[] = [];
  const seen = new Set<string>();
  for (const entry of submitted.slice(0, QUESTIONS_PER_MATCH)) {
    if (!entry || typeof entry !== "object") continue;
    const wordId = (entry as { wordId?: unknown }).wordId;
    if (typeof wordId !== "string" || seen.has(wordId)) continue;
    seen.add(wordId);
    const word = wordById(wordId);
    if (!word) continue;
    if (allowedWordIds && !allowedWordIds.has(word.id)) continue;
    const answers = relationAnswers(word, kind);
    if (!answers.length) continue;
    const raw = (entry as { selected?: unknown }).selected;
    const selected = Array.isArray(raw)
      ? raw
          .filter((value): value is string => typeof value === "string")
          .slice(0, 8)
      : [];
    graded.push({
      wordId: word.id,
      word: word.word,
      correct: gradeSelection(selected, answers),
    });
  }

  return recordGameMatch({ userId, kind, matchId, graded, seconds });
}
