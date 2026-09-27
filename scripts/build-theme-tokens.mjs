// One-off: replaces the hardcoded colour literals in globals.css with the
// semantic tokens defined at the top of that file. Kept in the repo so the
// mapping is reviewable and the check in tests/theme.test.mjs can be re-run.
//
// Run: node scripts/build-theme-tokens.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";

const CSS = new URL("../app/globals.css", import.meta.url);
const check = process.argv.includes("--check");

/**
 * Semantic tokens, grouped by the CSS property they are used from: a colour
 * used as text never resolves to a background token, and so on.
 */
const TOKENS = {
  ink: {
    "--ink": "#18253b",
    "--ink-2": "#3c4f68",
    "--ink-3": "#5c6b83",
    "--ink-4": "#8290a3",
    "--ink-5": "#a1aaba",
    "--ink-invert": "#ffffff",
    "--ink-brand": "#224f82",
    "--ink-brand-2": "#2358d5",
    "--ink-brand-5": "#2856ae",
    "--ink-brand-6": "#174da8",
    "--ink-brand-3": "#2a3d59",
    "--ink-brand-4": "#5c6c84",
    "--ink-on-brand": "#c9e7ff",
    "--ink-brand-soft": "#99b8ff",
    "--ink-slate": "#66738a",
    "--ink-navy": "#173e5a",
    "--ink-slate-deep": "#526981",
    "--ink-success": "#175c3f",
    "--ink-success-2": "#39815e",
    "--ink-success-3": "#41956e",
    "--ink-warn": "#8b6b2b",
    "--ink-warn-2": "#9b6a13",
    "--ink-amber": "#604809",
    "--ink-amber-2": "#6f571e",
    "--ink-amber-3": "#754c0c",
    "--ink-amber-4": "#76520c",
    "--ink-amber-5": "#864706",
    "--ink-amber-6": "#864706",
    "--ink-amber-deep": "#47370f",
    "--ink-olive": "#614b15",
    "--ink-olive-2": "#624711",
    "--ink-olive-3": "#653818",
    "--ink-olive-4": "#674711",
    "--ink-olive-5": "#695321",
    "--ink-olive-6": "#725214",
    "--ink-olive-7": "#74530e",
    "--ink-olive-8": "#805111",
    "--ink-violet": "#51418c",
    "--ink-gold": "#e0a63d",
    "--ink-danger": "#8f2b2b",
    "--ink-crimson": "#a02736",
    "--ink-purple": "#6854ae",
    "--ink-lilac": "#aa8bdf",
    "--ink-orange": "#e27629",
    "--ink-ice": "#d0ddf1",
    "--ink-pale": "#c2d0e8",
    "--ink-cyan": "#39729d",
    "--ink-sage": "#596c62",
  },
  surface: {
    "--surface": "#ffffff",
    "--surface-page": "#f4f6fa",
    "--surface-2": "#f8fafc",
    "--surface-3": "#f2f6fc",
    "--surface-4": "#edf1f8",
    "--surface-5": "#e2e8f0",
    "--surface-brand": "#eef4ff",
    "--surface-brand-2": "#e3f3ff",
    "--surface-brand-3": "#d6e6fb",
    "--surface-sky": "#eaf2ff",
    "--surface-success": "#eaf6ee",
    "--surface-success-2": "#d9f0e3",
    "--surface-success-3": "#e0f0e3",
    "--surface-warn": "#fff8df",
    "--surface-warn-2": "#fff0cf",
    "--surface-warn-3": "#fff9ed",
    "--surface-gold": "#fff3c7",
    "--surface-amber": "#f8d779",
    "--surface-amber-2": "#ffe6a0",
    "--surface-danger": "#fff0f0",
    "--surface-danger-2": "#fdeeee",
    "--surface-danger-3": "#fff3e7",
    "--surface-purple": "#f2effb",
    "--surface-purple-2": "#e9e7fb",
    "--surface-cream": "#fff6e5",
    "--surface-brand-solid": "#2358d5",
    "--surface-green": "#287450",
    "--surface-purple-solid": "#6854ae",
    "--surface-navy": "#153466",
    "--surface-navy-2": "#102d62",
    "--surface-slate": "#36507a",
    "--surface-teal": "#174b69",
    "--surface-sky-strong": "#1675e8",
    "--surface-mint": "#71c6a2",
    "--surface-periwinkle": "#6e83e6",
    "--surface-ice": "#a4cbfa",
    "--surface-sky-soft": "#92b3ff",
  },
  line: {
    "--line": "#dce3ef",
    "--line-2": "#e6ecf5",
    "--line-3": "#edf0f6",
    "--line-4": "#e0e7f2",
    "--line-5": "#cbdcf0",
    "--line-strong": "#a8b6cb",
    "--line-steel": "#b5c6d9",
    "--line-brand": "#bad0e8",
    "--line-brand-2": "#2358d5",
    "--line-success": "#cbded7",
    "--line-success-2": "#289658",
    "--line-warn": "#e2d3a8",
    "--line-warn-2": "#cba651",
    "--line-gold": "#f1d693",
    "--line-amber": "#a65b0a",
    "--line-amber-2": "#b87c13",
    "--line-amber-3": "#d7bd7c",
    "--line-amber-4": "#dfc276",
    "--line-amber-5": "#e5c66b",
    "--line-purple-solid": "#6854ae",
    "--line-green": "#287450",
    "--line-sage": "#75aa8a",
    "--line-denim": "#4d7ea8",
    "--line-steel-blue": "#6e89a4",
    "--line-danger": "#f0bdc4",
    "--line-danger-2": "#cb4f5c",
    "--line-purple": "#d4d4ec",
    "--line-slate": "#36507a",
    "--line-teal": "#174b69",
    "--line-navy": "#193e61",
    "--line-sand": "#e6d8bb",
    "--line-stone": "#e7e1d4",
    "--line-moss": "#cadcd5",
    "--line-ochre": "#edc3a1",
    "--line-sky": "#83a8cc",
  },
  misc: {
    "--focus": "#7aa7e8",
    "--focus-deep": "#236399",
    "--pick": "#2358d5",
    "--pick-deep": "#245b4c",
    "--pick-gold": "#e2a329",
    "--pick-amber": "#ffca78",
  },
};

/** Which token group each CSS property draws from. */
const FAMILY = {
  color: "ink",
  background: "surface",
  "background-color": "surface",
  "border": "line",
  "border-color": "line",
  "border-top": "line",
  "border-right": "line",
  "border-bottom": "line",
  "border-left": "line",
  "border-top-color": "line",
  "border-bottom-color": "line",
  "border-radius": "line",
  outline: "misc",
  "accent-color": "misc",
  fill: "misc",
  stroke: "misc",
};

const expand = (hex) => {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** Weighted RGB distance, good enough to keep a refactor visually identical. */
const distance = (a, b) => {
  const [ar, ag, ab] = expand(a);
  const [br, bg, bb] = expand(b);
  const rm = (ar + br) / 2;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return Math.sqrt(
    (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db,
  );
};

const groups = Object.fromEntries(
  Object.entries(TOKENS).map(([family, table]) => [
    family,
    Object.entries(table).map(([name, hex]) => ({ name, hex })),
  ]),
);

const nearest = (hex, family) => {
  let best = null;
  for (const candidate of groups[family]) {
    const d = distance(hex, candidate.hex);
    if (!best || d < best.d) best = { ...candidate, d };
  }
  return best;
};

const source = readFileSync(CSS, "utf8");
const errors = [];
const stats = {};
let changed = 0;

// Replace inside declarations only, so selectors and comments are untouched.
const rewritten = source.replace(
  /(^|[;{])(\s*)([-a-zA-Z]+)(\s*:\s*)([^;{}]*)(;)/gm,
  (whole, lead, space, prop, colon, value, semi) => {
    const family = FAMILY[prop.trim()];
    if (!family || !value.includes("#")) return whole;
    let next = value;
    for (const hex of value.match(/#[0-9a-fA-F]{3,8}\b/g) || []) {
      if (hex.toLowerCase() === "#fff" || hex.toLowerCase() === "#ffffff") {
        // White is its own token in every family it appears in.
        const name = family === "ink" ? "--ink-invert" : family === "surface" ? "--surface" : null;
        if (name) {
          next = next.replace(hex, `var(${name})`);
          changed += 1;
          continue;
        }
      }
      const pick = nearest(hex, family);
      if (!pick) continue;
      next = next.replace(hex, `var(${pick.name})`);
      changed += 1;
      const key = family;
      stats[key] = stats[key] || { count: 0, worst: 0, worstHex: hex, token: pick.name };
      stats[key].count += 1;
      if (pick.d > stats[key].worst) {
        stats[key].worst = pick.d;
        stats[key].worstHex = `${hex} -> ${pick.name} ${pick.hex}`;
      }
      if (pick.d > 60)
        errors.push(`${prop}: ${hex} is ${pick.d.toFixed(0)} away from ${pick.name} ${pick.hex}`);
    }
    return `${lead}${space}${prop}${colon}${next}${semi}`;
  },
);

console.log(`replacements: ${changed}`);
for (const [family, s] of Object.entries(stats))
  console.log(
    `  ${family.padEnd(8)} ${String(s.count).padStart(4)} uses, worst ${s.worst.toFixed(1)}  ${s.worstHex}`,
  );
if (errors.length) {
  console.log(`\n${errors.length} substitution(s) further than 60:`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log(`  ${e}`);
}
if (check) {
  process.exitCode = errors.length ? 1 : 0;
} else {
  writeFileSync(CSS, rewritten);
  console.log(`\nwrote ${CSS.pathname}`);
}
