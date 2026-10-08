/**
 * Where a child is, when they did not choose a level.
 *
 * When the practice picker is "all levels", questions used to come from the
 * whole collection uniformly: a fresh child had a one-in-six chance of opening
 * on a Level 5 word, and a child working through Level 1 kept drawing Level 5
 * words they could not yet read. This module decides the child's current band
 * and how questions split across bands, so practice concentrates where learning
 * happens and the child can see the level move.
 *
 * Pure and dependency-free on purpose. The browser engine and the server
 * question route both import it and must produce identical questions from
 * identical progress — `tests/client-engine.test.mjs` drives both over the same
 * fixtures — so nothing here may read a database, a clock, or randomness
 * beyond the function handed in. Randomness arrives as a parameter for exactly
 * that reason: the tests seed it, production passes Math.random.
 *
 * Three inputs, all of which both sides already hold:
 * - per-word mastered flags with their bands (from progress rows + bank levels),
 * - the trailing recent answers with their bands (in-session grades on the
 *   client, `learning_events` on the server, explicit fixtures in tests),
 * - nothing else. No stored level column: a stored level is a second source of
 *   truth that drifts from the rows it was computed from, and the drift is
 *   silent because both values look authoritative.
 */

/** Bands are 0–5. There is no level 6: the owner's "0 to 6" is the continuous
 * scale the six bands sit on, and the score mapping below is where it lives. */
export const BAND_COUNT = 6;
/** Share of a band's words mastered that promotes out of it. */
export const LEVEL_UP_FRACTION = 0.8;
/** A sustained collapse that demotes, and what "sustained" means. */
export const LEVEL_DOWN_FRACTION = 0.4;
export const SLOW_TRACK_MIN_ANSWERS = 30;
/** A fast run that promotes early, for a child placed too low. */
export const FAST_TRACK_MIN_ANSWERS = 20;
export const FAST_TRACK_ACCURACY = 0.9;
/** The top of the displayed score. Each band is worth a sixth of it. */
export const MAX_SCORE = 10000;

/** One recent answer: which band it was asked at, and whether it was an
 * unassisted correct answer. Assisted (clue shown), revealed and skipped
 * answers count as not-correct here, the same way they do not count toward
 * mastery — a child leaning on the clue must not fast-track upward. */
export type TrailingAnswer = {
  level: number;
  correct: boolean;
};

/** Share of each band's words mastered, index = band. Bands with no words in
 * the pool read 0 mastered of 0, which is treated as complete (1) so an empty
 * band never pins the child down: with nothing to learn there, there is
 * nothing to wait for. */
export function levelFractions(
  items: ReadonlyArray<{ level: number; mastered: boolean }>,
  totals: ReadonlyArray<number>,
): number[] {
  const mastered = [0, 0, 0, 0, 0, 0];
  for (const item of items) {
    if (item.mastered && item.level >= 0 && item.level < BAND_COUNT)
      mastered[item.level] += 1;
  }
  return totals.map((total, band) =>
    total <= 0 ? 1 : Math.min(1, (mastered[band] ?? 0) / total),
  );
}

/**
 * The child's band, 0–5.
 *
 * The slow rule first: the highest band with ≥80% mastered, plus one, floored
 * at 1 and capped at 5. A brand-new child has no mastered words, so this reads
 * 1 with no special case — L1, not L0, because L0 is the 116-word
 * curriculum-extension set on a different axis from the 1–5 frequency bands,
 * and promoting out of 80%-of-116 after a day would move the level for the
 * wrong reason.
 *
 * Then at most one adjustment from the trailing answers at that band:
 * - collapse (<40% over ≥30) steps down one: a sustained failure, never one
 *   bad round, and mastery flags are untouched — falling back changes what is
 *   asked, never what is already known;
 * - fast run (≥90% over ≥20) steps up one: a strong child placed too low must
 *   not grind hundreds of questions before the level moves. Ninety percent over
 *   twenty four-option questions cannot happen by guessing.
 *
 * Recomputed per question. That is safe mid-round precisely because the
 * thresholds are wide: the level only moves on sustained evidence, and moving
 * it the moment the evidence arrives is the celebration, not a glitch.
 */
export function currentLevel(
  fractions: ReadonlyArray<number>,
  trailing: ReadonlyArray<TrailingAnswer>,
): number {
  let highest = -1;
  for (let band = 0; band < BAND_COUNT; band++) {
    if ((fractions[band] ?? 0) >= LEVEL_UP_FRACTION) highest = band;
  }
  const base = Math.max(1, Math.min(5, highest + 1));
  const at = trailing.filter((answer) => answer.level === base);
  if (at.length >= SLOW_TRACK_MIN_ANSWERS) {
    const accuracy = at.filter((answer) => answer.correct).length / at.length;
    if (accuracy < LEVEL_DOWN_FRACTION) return Math.max(0, base - 1);
  }
  if (at.length >= FAST_TRACK_MIN_ANSWERS) {
    const accuracy = at.filter((answer) => answer.correct).length / at.length;
    if (accuracy >= FAST_TRACK_ACCURACY) return Math.min(5, base + 1);
  }
  return base;
}

/**
 * The displayed score, 0–10,000.
 *
 * `(level + fraction) / 6 × 10000`: each band is worth a sixth, progress within
 * the band fills it. Monotonic by construction — the band dominates the
 * fraction, so the number never runs backward while the level stands still —
 * and every newly mastered word moves it by ~4 points in a 426-word band, so
 * the number is alive long before the level changes.
 */
export function levelScore(level: number, fraction: number): number {
  const clamped = Math.max(0, Math.min(5, level));
  const filled = Math.max(0, Math.min(1, fraction));
  return Math.round(((clamped + filled) / BAND_COUNT) * MAX_SCORE);
}

/**
 * How questions split across bands at each level.
 *
 * The split is constant in shape and adaptive in balance: the band below
 * always keeps a fifth (revision), while the remaining four-fifths shift from
 * the current band to the next one as its words firm up. The shift follows
 * `stretchFraction` below - the share of the current band answered right at
 * least twice - so a fresh child meets nothing above their level and a child
 * who has nearly finished it is mostly asked what comes next. L0 has no band
 * below, so its fifth stays home; L5 has no band above, so its four-fifths do.
 *
 * Seventy percent the current band, fifteen each side used to be the rule for
 * every level: revision below, stretch above. A fixed fifth of stretch meant a
 * child on their first morning met a Level 2 word every fifth question, which
 * is what the adaptive balance fixes. The ±1 window itself is structural - a
 * Level 1 child still never draws Level 4 or 5 - and bands with nothing to ask
 * renormalise away at draw time rather than here.
 */
export const BELOW_BAND_SHARE = 0.2;
/** The current band's weight plus the next band's weight, always. */
export const CURRENT_NEXT_SHARE = 0.8;
/**
 * Right answers on one word that start opening the band above it.
 *
 * Two, not one: a single correct answer is evidence the child has met the
 * word, and the second is the first sign it is sticking. Assisted answers
 * never reach this count - the evidence rules do not credit them - so leaning
 * on the clue cannot open harder bands early.
 */
export const STRETCH_CORRECT = 2;

/**
 * How much of the next band is open, 0 to 1.
 *
 * The share of the band's words answered right at least twice. A band with no
 * words in the pool reads complete, like `levelFractions`: with nothing to
 * learn there, there is nothing to wait for before looking ahead.
 */
export function stretchFraction(
  items: ReadonlyArray<{ level: number; correct: number }>,
  totals: ReadonlyArray<number>,
  band: number,
): number {
  const total = totals[band] ?? 0;
  if (total <= 0) return 1;
  let ready = 0;
  for (const item of items) {
    if (item.level === band && (item.correct ?? 0) >= STRETCH_CORRECT)
      ready += 1;
  }
  return Math.min(1, ready / total);
}

export function allocationFor(
  level: number,
  nextFraction = 0,
): ReadonlyMap<number, number> {
  const clamped = Math.max(0, Math.min(5, level));
  const frac = Math.max(0, Math.min(1, nextFraction));
  const weights = new Map<number, number>();
  // The revision fifth, folded home at the bottom where no band sits below.
  const below = clamped > 0 ? BELOW_BAND_SHARE : 0;
  if (below > 0) weights.set(clamped - 1, below);
  // The stretch, folded home at the top where no band sits above.
  const ahead = clamped < 5 ? CURRENT_NEXT_SHARE * frac : 0;
  weights.set(clamped, 1 - below - ahead);
  if (ahead > 0) weights.set(clamped + 1, ahead);
  return weights;
}

/**
 * Which band the next question comes from.
 *
 * Bands with no available words are removed and the rest renormalise, so an
 * exhausted or excluded band never eats the draw and a fully-mastered band
 * quietly yields to its neighbours. With one band left the draw is trivially
 * that band; with none, null — the caller already handles "nothing to ask".
 */
export function drawBand(
  weights: ReadonlyMap<number, number>,
  availableBands: ReadonlySet<number>,
  random: () => number,
): number | null {
  let total = 0;
  const entries: Array<[number, number]> = [];
  for (const [band, weight] of weights) {
    if (availableBands.has(band) && weight > 0) {
      entries.push([band, weight]);
      total += weight;
    }
  }
  if (!entries.length) return null;
  let roll = random() * total;
  for (const [band, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return band;
  }
  return entries[entries.length - 1][0];
}

/**
 * Narrow a candidate set to one drawn band.
 *
 * The shared second stage of the draw, used by the browser engine and the
 * server question route alike: due mistake-reviews bypass it entirely (the
 * caller checks that first), otherwise the band comes from the allocation
 * weights and the word is picked inside it. A drawn band with nothing to ask
 * leaves the full set in place rather than returning nothing — an exhausted
 * band must yield to its neighbours, never stall practice.
 */
export function narrowToBand<T>(
  available: ReadonlyArray<T>,
  bandOf: (word: T) => number,
  weights: ReadonlyMap<number, number>,
  random: () => number,
): { band: number | null; words: T[] } {
  const bands = new Set<number>();
  for (const word of available) {
    const band = bandOf(word);
    if (band >= 0 && band < BAND_COUNT) bands.add(band);
  }
  const band = drawBand(weights, bands, random);
  if (band === null) return { band: null, words: [...available] };
  const inBand = available.filter((word) => bandOf(word) === band);
  return inBand.length
    ? { band, words: inBand }
    : { band: null, words: [...available] };
}

/** The shape both question paths attach to what they hand out. */
export type Placement = {
  level: number;
  score: number;
};
