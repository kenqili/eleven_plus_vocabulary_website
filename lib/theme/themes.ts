/**
 * The themes on offer. Adding one is a data change: give it an id, a label and
 * a short description, then add a [data-theme="id"] block to globals.css that
 * redefines the tokens listed in `mustDefine`. Nothing in the app needs to
 * know the theme exists, which is the point.
 */
export type Theme = {
  id: string;
  label: string;
  description: string;
  /** Shown on the swatch, in the same order as `swatch`. */
  swatch: readonly string[];
};

export const THEMES: readonly Theme[] = [
  {
    id: "classic",
    label: "Blue Book",
    description: "The original calm blue. Quiet and easy on the eyes.",
    swatch: ["#2358d5", "#eef4ff", "#18253b", "#dce3ef"],
  },
  {
    id: "minecraft",
    label: "Blocky",
    description:
      "Grass, stone and wood. A world-building look, for children who like building games.",
    swatch: ["#4b7a2a", "#8b5a2b", "#2d2d33", "#c8c8c8"],
  },
  {
    id: "sunshine",
    label: "Sunshine",
    description: "Warm and bright, with big rounded shapes.",
    swatch: ["#e07a1f", "#fff3d6", "#3d2a12", "#f0c98a"],
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "A dark screen for late practice, easy on tired eyes.",
    swatch: ["#5b8def", "#1a1f2e", "#e6ebf5", "#2c3346"],
  },
] as const;

export const DEFAULT_THEME = "classic";

/** The tokens a theme must set to be readable on its own. Checked in tests. */
export const REQUIRED_TOKENS = [
  "--surface",
  "--surface-page",
  "--surface-4",
  "--ink",
  "--ink-3",
  "--ink-invert",
  "--surface-brand-solid",
  "--ink-on-brand",
  "--line",
  "--line-strong",
  "--focus",
] as const;

export const isThemeId = (value: unknown): value is string =>
  typeof value === "string" && THEMES.some((theme) => theme.id === value);

/** Unknown or missing values fall back to the default rather than breaking. */
export function themeById(id: unknown): Theme {
  return (
    (isThemeId(id) ? THEMES.find((theme) => theme.id === id) : undefined) ??
    THEMES[0]
  );
}

export const THEME_STORAGE_KEY = "minewords:theme";
