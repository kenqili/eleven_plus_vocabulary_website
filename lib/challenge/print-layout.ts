/**
 * A4 word sheets. A sheet is a grid, and how much fits in a cell decides how
 * much can be shown, so the three are chosen together rather than freely
 * combined. A4 portrait with 12mm margins leaves 186mm by 273mm to work with.
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

const density = (
  id: string,
  columns: number,
  rows: number,
  label: string,
  maxContent: ContentMode,
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
    maxContent,
  };
};

export const DENSITIES: Density[] = [
  density("2x6", 2, 6, "Large · 12 a page", "example"),
  density("3x8", 3, 8, "Big · 24 a page", "example"),
  density("4x10", 4, 10, "Medium · 40 a page", "meaning"),
  density("5x12", 5, 12, "Small · 60 a page", "word"),
];

export const CONTENT_LABELS: Record<ContentMode, string> = {
  word: "Word only",
  meaning: "Word and meaning",
  example: "Word, meaning and example",
};

export const isDensity = (value: string) =>
  DENSITIES.some((entry) => entry.id === value);
export const isContentMode = (value: string) =>
  (CONTENT_MODES as readonly string[]).includes(value);

export const densityFor = (id: string) =>
  DENSITIES.find((entry) => entry.id === id) ?? DENSITIES[0];

/** The densest grid that can carry the requested content. */
export const bestDensityFor = (content: ContentMode) =>
  DENSITIES.find((entry) => entry.maxContent === content) ??
  DENSITIES[DENSITIES.length - 1];

/**
 * A grid is only offered for content it can actually show, so a parent never
 * picks a combination that prints as unreadable grey text.
 */
export function resolveSheet(
  layout: string | null,
  content: string | null,
): { density: Density; content: ContentMode } {
  const wanted: ContentMode = isContentMode(content ?? "")
    ? (content as ContentMode)
    : "meaning";
  const chosen = isDensity(layout ?? "") ? densityFor(layout!) : null;
  if (chosen && CONTENT_MODES.indexOf(wanted) <= CONTENT_MODES.indexOf(chosen.maxContent))
    return { density: chosen, content: wanted };
  return { density: bestDensityFor(wanted), content: wanted };
}

/** Font size for the cell body, in points, that keeps the text legible. */
export const bodyFontPt = (density: Density, content: ContentMode) => {
  const area = density.cellAreaMm2;
  if (content === "word") return area > 3000 ? 22 : area > 1200 ? 16 : 11;
  if (content === "meaning") return area > 3000 ? 13 : area > 1200 ? 10 : 8;
  return area > 3000 ? 11 : area > 1200 ? 9 : 7.5;
};
