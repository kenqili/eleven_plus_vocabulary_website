/**
 * A4 word sheets. A sheet is a grid, and how much fits in a cell decides how
 * much can be shown, so the two are solved together rather than picked
 * independently. A4 portrait with 12mm margins leaves 186mm by 273mm to fill.
 */
export const A4 = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 12,
  get usableWidthMm() {
    return this.widthMm - this.marginMm * 2;
  },
  get usableHeightMm() {
    return this.heightMm - this.marginMm * 2;
  },
  get usableAreaMm2() {
    return this.usableWidthMm * this.usableHeightMm;
  },
} as const;

export const CONTENT_MODES = ["word", "meaning", "example"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export type Density = {
  id: string;
  columns: number;
  rows: number;
  label: string;
  /** Usable area of one cell, after the gap between cells. */
  cellWidthMm: number;
  cellHeightMm: number;
  cellAreaMm2: number;
  /** The densest content this grid can show without turning to mush. */
  maxContent: ContentMode;
};

const GAP_MM = 4;

/**
 * How text is measured against a cell. These are the numbers the fit depends
 * on, kept here so the printed sheet and the check that guards it cannot
 * disagree about what fits.
 */
export const MEASURE = {
  mmPerPt: 25.4 / 72,
  /** Arial's average advance width across mixed-case English. */
  emWidth: 0.5,
  /** Long words break badly, so assume a little of each line is lost. */
  wrapEfficiency: 0.92,
  lineHeight: 1.3,
  /** 2mm of padding top and bottom. */
  padMm: 4,
  /** The gap between the word, its meaning and its example. */
  gapMm: 1,
  /** The word itself is set larger than the text around it. */
  wordEm: 1.15,
  /** Sideways padding inside a cell. */
  padXmm: 2.5,
  /**
   * Fraction of the cell a cell's text is allowed to fill. The measurement
   * above is an estimate, and browsers break text slightly differently, so
   * the text is fitted to a little under the cell rather than exactly to it.
   */
  headroom: 0.92,
} as const;

/** The height a cell's text must stay within for this grid. */
export const usableCellHeightMm = (entry: Density) =>
  entry.cellHeightMm * MEASURE.headroom;

const density = (
  id: string,
  columns: number,
  rows: number,
  label: string,
): Density => {
  const cellWidthMm = (A4.usableWidthMm - GAP_MM * (columns - 1)) / columns;
  const cellHeightMm = (A4.usableHeightMm - GAP_MM * (rows - 1)) / rows;
  return {
    id,
    columns,
    rows,
    label,
    cellWidthMm: Math.round(cellWidthMm * 10) / 10,
    cellHeightMm: Math.round(cellHeightMm * 10) / 10,
    cellAreaMm2: Math.round(cellWidthMm * cellHeightMm),
    // Filled in below, once the fit can be measured.
    maxContent: "word",
  };
};

export const DENSITIES: Density[] = [
  density("2x6", 2, 6, "Large · 12 a page"),
  density("3x8", 3, 8, "Big · 24 a page"),
  density("4x10", 4, 10, "Medium · 40 a page"),
  density("5x12", 5, 12, "Small · 60 a page"),
];

export const CONTENT_LABELS: Record<ContentMode, string> = {
  word: "Word only",
  meaning: "Word and meaning",
  example: "Word, meaning and example",
};

/**
 * Below this a printed reference sheet stops being usable. A child reading a
 * sheet is reading it, not skimming it, and 8pt is contract fine print.
 */
export const MIN_BODY_PT = 10;
/** Above this the type stops looking like a study sheet. */
export const MAX_BODY_PT = 22;

/**
 * How long the text in a cell is, taken from the bank. 95th percentile, so
 * almost every word prints in full and the longest few are shortened rather
 * than overflowing. A test asserts this still matches the bank, so the
 * constant is never quietly stale.
 */
export const SHEET_TEXT_PROFILE = {
  word: 12,
  meaning: 95,
  example: 116,
} as const;

type Segment = { text: string; em: number };

/** Height in mm a run of text needs in a cell of this width. */
export const textHeightMm = (
  segments: readonly Segment[],
  bodyPt: number,
  cellWidthMm: number,
) => {
  const innerWidth = cellWidthMm - MEASURE.padXmm * 2;
  let height = MEASURE.padMm + MEASURE.gapMm * Math.max(0, segments.length - 1);
  for (const segment of segments) {
    const size = bodyPt * segment.em;
    const perLine = Math.max(
      1,
      (innerWidth / (size * MEASURE.mmPerPt * MEASURE.emWidth)) *
        MEASURE.wrapEfficiency,
    );
    height +=
      Math.max(1, Math.ceil(segment.text.length / perLine)) *
      size *
      MEASURE.mmPerPt *
      MEASURE.lineHeight;
  }
  return height;
};

/** The text a cell of this density would show in this content mode. */
export const cellText = (
  word: { word: string; definition: string; example?: string },
  content: ContentMode,
  budget: { meaning: number; example: number } = {
    meaning: SHEET_TEXT_PROFILE.meaning,
    example: SHEET_TEXT_PROFILE.example,
  },
) => {
  const clamp = (value: string, max: number) =>
    value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
  const segments: Segment[] = [{ text: word.word, em: MEASURE.wordEm }];
  if (content !== "word")
    segments.push({ text: clamp(word.definition, budget.meaning), em: 1 });
  if (content === "example" && word.example)
    segments.push({ text: clamp(word.example, budget.example), em: 1 });
  return segments;
};

export type Sheet = {
  density: Density;
  content: ContentMode;
  bodyPt: number;
  /** Characters of meaning and example a cell shows before shortening. */
  meaningChars: number;
  exampleChars: number;
};

/**
 * The largest type that shows this content in this cell, shortening the text
 * only if the type would otherwise fall below MIN_BODY_PT. Returns null when
 * the grid cannot carry the content legibly at all, which is what keeps a
 * combination off the picker.
 */
export function fitSheet(
  entry: Density,
  content: ContentMode,
): Sheet | null {
  if (content === "word") {
    for (let pt = MAX_BODY_PT; pt >= MIN_BODY_PT; pt -= 0.5) {
      const need = textHeightMm(
        [{ text: "x".repeat(SHEET_TEXT_PROFILE.word), em: MEASURE.wordEm }],
        pt,
        entry.cellWidthMm,
      );
      if (need <= usableCellHeightMm(entry))
        return {
          density: entry,
          content,
          bodyPt: pt,
          meaningChars: SHEET_TEXT_PROFILE.meaning,
          exampleChars: SHEET_TEXT_PROFILE.example,
        };
    }
    return null;
  }
  // Try the full text first, then progressively shorter, taking the largest
  // type that still works at each length.
  const steps: { meaning: number; example: number }[] = [
    { meaning: SHEET_TEXT_PROFILE.meaning, example: SHEET_TEXT_PROFILE.example },
    { meaning: 80, example: 90 },
    { meaning: 60, example: 60 },
    { meaning: 45, example: 40 },
  ];
  for (const budget of steps) {
    for (let pt = MAX_BODY_PT; pt >= MIN_BODY_PT; pt -= 0.5) {
      const sample = {
        word: "incontrovertible",
        definition: "x".repeat(budget.meaning),
        example: "x".repeat(budget.example),
      };
      if (
        textHeightMm(cellText(sample, content, budget), pt, entry.cellWidthMm) <=
        usableCellHeightMm(entry)
      )
        return {
          density: entry,
          content,
          bodyPt: pt,
          meaningChars: budget.meaning,
          exampleChars: budget.example,
        };
    }
  }
  return null;
}

/** Every combination that can actually be printed, largest type first. */
export const SHEETS: Sheet[] = DENSITIES.flatMap((entry) =>
  CONTENT_MODES.map((content) => fitSheet(entry, content)).filter(
    (sheet): sheet is Sheet => sheet !== null,
  ),
);

// Each grid can only show the most content that fits it.
for (const entry of DENSITIES) {
  const fits = CONTENT_MODES.filter((mode) => fitSheet(entry, mode));
  entry.maxContent = fits[fits.length - 1] ?? "word";
}

export const isDensity = (value: string) =>
  DENSITIES.some((entry) => entry.id === value);
export const isContentMode = (value: string) =>
  (CONTENT_MODES as readonly string[]).includes(value);
export const densityFor = (id: string) =>
  DENSITIES.find((entry) => entry.id === id) ?? DENSITIES[0];
export const canShow = (entry: Density, content: ContentMode) =>
  CONTENT_MODES.indexOf(content) <= CONTENT_MODES.indexOf(entry.maxContent);

/** The densest grid that can carry the requested content. */
/**
 * The grid a parent should start from for a given content mode: the roomiest
 * one that can carry it.
 *
 * Roomiest, not densest, because this is the default. It is what a child opens,
 * and a sheet is worth more with space to write in and a font big enough to read
 * off the page than with three times as many words on it. Tightening it is then
 * a deliberate choice rather than the thing that happens by default.
 */
export const bestDensityFor = (content: ContentMode) =>
  DENSITIES.find(
    (entry) => CONTENT_MODES.indexOf(content) <= CONTENT_MODES.indexOf(entry.maxContent),
  ) ?? DENSITIES[DENSITIES.length - 1];

/**
 * A grid is only offered for content it can actually show, so a parent never
 * picks a combination that prints as unreadable grey text.
 */
export function resolveSheet(
  layout: string | null,
  content: string | null,
): Sheet {
  // Word plus meaning, and the roomiest grid, because that is what a child can
  // actually read. A denser grid that fits the same text smaller is not a
  // better sheet.
  const wanted: ContentMode = isContentMode(content ?? "")
    ? (content as ContentMode)
    : "meaning";
  const chosen = isDensity(layout ?? "") ? densityFor(layout!) : null;
  if (chosen && canShow(chosen, wanted)) {
    const sheet = fitSheet(chosen, wanted);
    if (sheet) return sheet;
  }
  const fallback = fitSheet(bestDensityFor(wanted), wanted);
  return (
    fallback ?? {
      density: DENSITIES[0],
      content: wanted,
      bodyPt: MIN_BODY_PT,
      meaningChars: 45,
      exampleChars: 40,
    }
  );
}

/**
 * The font size for a cell, kept for callers that only need the number. Uses
 * the solved size where the combination is printable.
 */
export const bodyFontPt = (entry: Density, content: ContentMode) =>
  fitSheet(entry, content)?.bodyPt ?? MIN_BODY_PT;
