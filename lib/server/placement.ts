import { levelOf } from "@/lib/challenge/bank";
import {
  difficultyForAddedWord,
  toCustomWord,
} from "@/lib/challenge/added-words";
import {
  currentLevel,
  levelFractions,
  levelScore,
  stretchFraction,
  type TrailingAnswer,
} from "@/lib/challenge/placement";
import { hasMastered } from "@/lib/challenge/mastery";
import { customWordsFor, excludedWordIds } from "./parent-words";
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

async function bandPool(userId: string): Promise<BandPool> {
  const db = database();
  const [excluded, added] = await Promise.all([
    excludedWordIds(userId),
    customWordsFor(userId),
  ]);
  const rows = (
    await db
      .prepare(
        "SELECT word_id, correct, mastered FROM progress WHERE user_id = ?",
      )
      .bind(userId)
      .all<{ word_id: string; correct: number; mastered: number }>()
  ).results;
  const byId = new Map(rows.map((row) => [row.word_id, row]));
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

/**
 * The trailing recent answers, most recent last.
 *
 * Read from `learning_events` rather than `attempts` because only it records
 * the evidence verdict. Shared with the question route so the two cannot drift
 * into different definitions of "recent".
 */
export async function trailingAnswers(
  userId: string,
): Promise<TrailingAnswer[]> {
  const db = database();
  const rows = (
    await db
      .prepare(
        "SELECT word_id, correct, revealed, evidence FROM learning_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
      )
      .bind(userId)
      .all<{
        word_id: string;
        correct: number;
        revealed: number;
        evidence: string | null;
      }>()
  ).results;
  return rows.reverse().map((row) => ({
    level: bandFor(row.word_id),
    correct:
      row.correct === 1 &&
      row.revealed === 0 &&
      (row.evidence === "recalled" || row.evidence === "uncertain"),
  }));
}

export async function accountPlacement(userId: string): Promise<{
  level: number;
  score: number;
}> {
  const [{ totals, items }, trailing] = await Promise.all([
    bandPool(userId),
    trailingAnswers(userId),
  ]);
  const fractions = levelFractions(items, totals);
  const base = currentLevel(fractions, trailing);
  const level = currentLevel(
    fractions,
    trailing,
    stretchFraction(items, totals, base) >= 1,
  );
  return { level, score: levelScore(level, fractions[level] ?? 0) };
}

/**
 * The score over time, one point per day a word was first mastered.
 *
 * Reconstructed from `learning_events`: each word contributes from the first
 * day an event recorded its mastery. Words flagged mastered in `progress`
 * without such an event (older history, from before evidence was recorded)
 * fall back to their last-seen day — mastered by then at the latest, so the
 * line never claims earlier knowledge than the rows support.
 *
 * Levels along the line use fractions only, never trailing accuracy: history
 * cannot be re-graded, and a line that moved on evidence nobody can inspect
 * would not be checkable. The live badge may sit slightly above the line's end
 * after a fast-track promotion; the next mastered word reconciles them.
 */
export async function scoreHistory(
  userId: string,
): Promise<Array<{ day: string; score: number }>> {
  const db = database();
  const masteredDays = (
    await db
      .prepare(
        "SELECT word_id, MIN(day) AS day FROM learning_events WHERE user_id = ? AND mastered = 1 GROUP BY word_id",
      )
      .bind(userId)
      .all<{ word_id: string; day: string }>()
  ).results;
  const flagged = (
    await db
      .prepare(
        "SELECT word_id, last_seen FROM progress WHERE user_id = ? AND mastered = 1",
      )
      .bind(userId)
      .all<{ word_id: string; last_seen: string | null }>()
  ).results;
  const dayOf = new Map(masteredDays.map((row) => [row.word_id, row.day]));
  for (const row of flagged) {
    if (!dayOf.has(row.word_id) && row.last_seen)
      dayOf.set(row.word_id, row.last_seen);
  }
  if (!dayOf.size) return [];
  const bandOf = new Map<string, number>();
  for (const [id, band] of levelOf) bandOf.set(id, band);
  const byDay = new Map<string, string[]>();
  for (const [id, day] of dayOf) {
    const list = byDay.get(day) ?? [];
    list.push(id);
    byDay.set(day, list);
  }
  // Totals are the bank's, matching accountPlacement minus own words: history
  // predates neither, but a parent's added words have no stable band history
  // and would move old points whenever one is added or removed.
  const totals = [0, 0, 0, 0, 0, 0];
  for (const band of levelOf.values()) totals[band] += 1;
  const masteredCount = [0, 0, 0, 0, 0, 0];
  const points: Array<{ day: string; score: number }> = [];
  for (const day of [...byDay.keys()].sort()) {
    for (const id of byDay.get(day)!) {
      const band = bandOf.get(id);
      if (band !== undefined) masteredCount[band] += 1;
    }
    const fractions = totals.map((total, band) =>
      total <= 0 ? 1 : Math.min(1, masteredCount[band] / total),
    );
    const level = currentLevel(fractions, []);
    points.push({ day, score: levelScore(level, fractions[level] ?? 0) });
  }
  return points;
}
