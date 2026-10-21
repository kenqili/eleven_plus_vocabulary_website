import { levelOf } from "@/lib/challenge/bank";
import {
  difficultyForAddedWord,
  toCustomWord,
} from "@/lib/challenge/added-words";
import {
  currentLevel,
  correctCredit,
  levelFractions,
  levelScore,
  stretchFraction,
  type TrailingAnswer,
} from "@/lib/challenge/placement";
import { hasMastered } from "@/lib/challenge/mastery";
import {
  CUSTOM_WORDS_SQL,
  EXCLUDED_WORD_IDS_SQL,
  customWordsFromRows,
  excludedIdsFromRows,
  type AddedWord,
  type CustomWordRow,
} from "./parent-words";
import { database } from "./db";
/**
 * Where the account is, for pages that are not asking a question.
 *
 * The practice question route computes this inline because it already holds
 * the pool it filters; the score chart and the story library read it here.
 * Same inputs, same functions, so all three agree: mastered flags from
 * `progress`, trailing accuracy from `learning_events`, bands from the bank.
 *
 * Semantics differ from the question route in one documented way: this covers
 * the account's knowledge (bank + own words − excluded words) rather than the
 * practice pool of the moment (which also folds in the chosen types and the
 * free-tier allow-list). For a full-access account practising all types the
 * two coincide exactly; for anyone else the badge on a question is the live
 * number and this is the trend. Conflating them would mean threading
 * entitlement into every consumer.
 */

/**
 * Which band a word id belongs to.
 *
 * The same rule as `levelFor` in `./challenge`, which cannot be imported here
 * without a module cycle (it imports this file for `trailingAnswers`). A
 * parent's own word is not in the bank, so it falls back to its length — short
 * words read easier, which is all the information there is.
 */
const bandFor = (id: string): number =>
  levelOf.get(id) ?? difficultyForAddedWord(id.replace(/^own:/, "")).difficulty;

type BandPool = {
  totals: number[];
  items: Array<{ level: number; mastered: boolean; correct: number }>;
};

/** The child's own progress, which decides what they have mastered. */
const PROGRESS_SQL =
  "SELECT word_id, correct, mastered FROM progress WHERE user_id = ?";

/**
 * The trailing recent answers, most recent last.
 *
 * Read from `learning_events` rather than `attempts` because only it records
 * the evidence verdict. Shared with the question route so the two cannot drift
 * into different definitions of "recent".
 */
const TRAILING_SQL =
  "SELECT word_id, correct, revealed, evidence FROM learning_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 30";

/** The permanent penalty the account's hints have cost it. */
const PENALTY_SQL = "SELECT score_penalty FROM users WHERE id=?";

/**
 * The band pool, from rows already read.
 *
 * Separated from the read so one round trip can fetch every input at once.
 */
function bandPoolFrom(
  excluded: ReadonlySet<string>,
  added: readonly AddedWord[],
  progressRows: readonly {
    word_id: string;
    correct: number;
    mastered: number;
  }[],
): BandPool {
  const byId = new Map(progressRows.map((row) => [row.word_id, row]));
  const totals = [0, 0, 0, 0, 0, 0];
  const items: BandPool["items"] = [];
  for (const [id, band] of levelOf) {
    if (excluded.has(id)) continue;
    totals[band] += 1;
    const row = byId.get(id);
    items.push({
      level: band,
      mastered: hasMastered({
        mastered: row?.mastered,
        correct: row?.correct ?? 0,
      }),
      correct: row?.correct ?? 0,
    });
  }
  // A parent's own words sit where the question route puts them: by length,
  // since a word with no corpus frequency has no other band to belong to.
  // Namespaced the same way (`own:<word>`), so progress rows join correctly.
  for (const word of added) {
    const id = toCustomWord(word).id;
    if (excluded.has(id)) continue;
    const band = bandFor(id);
    if (band < 0 || band > 5) continue;
    totals[band] += 1;
    const row = byId.get(id);
    items.push({
      level: band,
      mastered: hasMastered({
        mastered: row?.mastered,
        correct: row?.correct ?? 0,
      }),
      correct: row?.correct ?? 0,
    });
  }
  return { totals, items };
}

/** The trailing answers, from rows already read. Most recent last. */
function trailingFromRows(
  rows: readonly {
    word_id: string;
    correct: number;
    revealed: number;
    evidence: string | null;
  }[],
): TrailingAnswer[] {
  return rows
    .slice()
    .reverse()
    .map((row) => ({
      level: bandFor(row.word_id),
      correct:
        row.correct === 1 &&
        row.revealed === 0 &&
        (row.evidence === "recalled" || row.evidence === "uncertain"),
    }));
}

/**
 * The trailing recent answers, for the callers that want them on their own.
 *
 * The shared definition of "recent". Read from `learning_events` rather than
 * `attempts` because only it records the evidence verdict. The question route
 * and the score chart both use it, so the two cannot drift into different
 * definitions.
 */
export async function trailingAnswers(
  userId: string,
): Promise<TrailingAnswer[]> {
  const rows = (
    await database()
      .prepare(TRAILING_SQL)
      .bind(userId)
      .all<{
        word_id: string;
        correct: number;
        revealed: number;
        evidence: string | null;
      }>()
  ).results;
  return trailingFromRows(rows);
}

export async function accountPlacement(userId: string): Promise<{
  level: number;
  score: number;
}> {
  const { level, score } = await accountScore(userId);
  return { level, score };
}

/**
 * The account's level, score and permanent hint penalty.
 *
 * `score` is the score the account would show, so the hint penalty has already
 * been taken off it. `penalty` is that deduction on its own, for the pages that
 * show what the hints cost.
 *
 * Read in one round trip. The placement used to be five separate queries: the
 * excluded words, the parent's own words, the child's progress, the trailing
 * answers and the hint penalty. D1 answers a batch in a single request, so the
 * whole placement now costs one trip instead of five. This is on the path of
 * every practice question and every Five Letters guess, and it reads the same
 * five rows every time, so the round trips were being paid for twice over.
 */
export async function accountScore(userId: string): Promise<{
  level: number;
  score: number;
  penalty: number;
}> {
  const db = database();
  const out = await db.batch([
    db.prepare(EXCLUDED_WORD_IDS_SQL).bind(userId),
    db.prepare(CUSTOM_WORDS_SQL).bind(userId),
    db.prepare(PROGRESS_SQL).bind(userId),
    db.prepare(TRAILING_SQL).bind(userId),
    db.prepare(PENALTY_SQL).bind(userId),
  ]);
  // `db.batch` returns one result per statement, in the order they were given -
  // D1 guarantees that positionally, and the shim preserves it with a map. D1
  // types the rows as unknown, so each is narrowed where it is read rather than
  // by casting the whole result.
  const rowsOf = <T,>(index: number): T[] =>
    index < 0
      ? []
      : ((out[index] as { results?: T[] } | undefined)?.results ?? []);
  const excluded = excludedIdsFromRows(rowsOf<{ word_id: string }>(0));
  const added = customWordsFromRows(rowsOf<CustomWordRow>(1));
  const { totals, items } = bandPoolFrom(
    excluded,
    added,
    rowsOf<{ word_id: string; correct: number; mastered: number }>(2),
  );
  const trailing = trailingFromRows(
    rowsOf<{
      word_id: string;
      correct: number;
      revealed: number;
      evidence: string | null;
    }>(3),
  );
  const penalty = rowsOf<{ score_penalty: number }>(4)[0]?.score_penalty ?? 0;
  const fractions = levelFractions(items, totals);
  const base = currentLevel(fractions, trailing);
  const level = currentLevel(
    fractions,
    trailing,
    stretchFraction(items, totals, base) >= 1,
  );
  return {
    level,
    // Five Letters hints are permanent and account-level. Subtracting here as
    // well as in the game means every reader of the score sees one number.
    score: Math.max(
      0,
      levelScore(level, correctCredit(items, totals, level)) - penalty,
    ),
    penalty,
  };
}
