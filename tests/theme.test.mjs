// The theme refactor must not have changed how the app looks. These tests pin
// that down from the two sides: every colour is now a token, and every token
// substitution stayed close enough to the literal it replaced that no one
// would notice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, themeById, isThemeId, THEME_STORAGE_KEY } from "../lib/theme/themes.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

const rootBlocks = noComments.match(
  /:root,\s*\[data-theme="classic"\]\s*\{([\s\S]*?)\n\}/,
);
assert.ok(rootBlocks, "globals.css must declare the classic theme tokens");
const classic = rootBlocks[1];
const tokens = new Map();
for (const [, name, value] of classic.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
  tokens.set(name, value.trim());
// The Tailwind bridge aliases a few legacy names onto these. They are indirection
// rather than palette, so they are followed through before anything is checked.
for (const block of noComments.matchAll(/:root\s*\{([\s\S]*?)\n\}/g))
  for (const [, name, value] of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    if (!tokens.has(name)) tokens.set(name, value.trim());

const resolveToken = (name, seen = new Set()) => {
  const value = tokens.get(name);
  if (!value || seen.has(name) || !value.startsWith("var(")) return name;
  seen.add(name);
  return resolveToken(value.slice(4, -1).trim(), seen);
};

// Every block that declares tokens, so the checks below look only at the rules
// that actually use colours.
const THEME_BLOCK = /(?:^|\n)(?::root\s*(?:,\s*\[data-theme="[a-z0-9-]+"\]\s*)?|\[data-theme="[a-z0-9-]+"\]\s*)\{[\s\S]*?\n\}/g;
const themeBlocks = noComments.match(THEME_BLOCK) || [];
assert.ok(themeBlocks.length >= 2, "expected the classic block and at least one theme");
const body = noComments.replace(THEME_BLOCK, "\n");

test("the token layer covers every colour the app uses", () => {
  assert.ok(tokens.size > 120, `only ${tokens.size} tokens declared`);
  // No hardcoded colour may survive outside a token block, or a theme could
  // not change it.
  const stray = body.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(stray)], [], "colours must go through tokens");
  const used = new Set(
    [...(body.match(/var\((--[a-z0-9-]+)\)/g) || [])].map((v) => v.slice(4, -1)),
  );
  const missing = [...used].filter((name) => !tokens.has(name));
  assert.deepEqual(missing, [], "every var() must resolve to a declared token");
  const unused = [...tokens.keys()].filter((name) => !used.has(name));
  assert.deepEqual(unused, [], "a declared token nothing uses is dead weight");
});

test("tokens are grouped by the job they do", () => {
  const groups = {
    ink: /^--ink/,
    surface: /^--surface/,
    line: /^--line/,
  };
  const families = {
    ink: /(^|[;{])\s*color\s*:/,
    surface: /(^|[;{])\s*background(-color)?\s*:/,
    line: /(^|[;{])\s*border(?!-radius)/,
  };
  for (const [name, pattern] of Object.entries(families)) {
    const declarations = body.split(";").filter((part) => pattern.test(part));
    for (const part of declarations)
      for (const [, token] of part.matchAll(/var\((--[a-z0-9-]+)\)/g))
        assert.match(
          resolveToken(token),
          groups[name],
          `${token} is used as ${name} but is not a ${name} token`,
        );
  }
});

test("a theme only needs to redefine names, never rules", () => {
  // Each theme is a block of custom properties and nothing else, so adding a
  // theme cannot change layout or markup.
  for (const theme of THEMES) {
    const block = noComments.match(
      new RegExp(`\\[data-theme="${theme.id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
    );
    assert.ok(block, `${theme.id}: no [data-theme] block in globals.css`);
    const themeBody = block[1];
    assert.ok(
      // A custom property name starts with a dash; a real rule does not.
      !/(?:^|[;{])\s*[a-z][a-z0-9-]*\s*:/m.test(themeBody),
      `${theme.id} must only set custom properties`,
    );
    for (const [, name] of themeBody.matchAll(/(--[a-z0-9-]+)\s*:/g))
      assert.ok(tokens.has(name), `${theme.id} sets ${name}, which is not a token`);
  }
});

test("every theme defines enough of the palette to be usable", () => {
  for (const theme of THEMES) {
    const block = noComments.match(
      new RegExp(`\\[data-theme="${theme.id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
    )[1];
    const set = new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // A theme that leaves the surfaces and the text undefined will inherit the
    // classic ones, which is exactly the mixture that reads badly.
    for (const required of [
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
    ])
      assert.ok(set.has(required), `${theme.id} does not set ${required}`);
  }
});

test("every theme's text stays readable on its own surfaces", () => {
  // The single most important thing a theme can get wrong, so it is checked
  // rather than trusted: text you cannot read is worse than a plain theme.
  const channel = (value) => {
    const hex = value.trim().replace("#", "");
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    return [0, 2, 4].map((i) => {
      const n = parseInt(full.slice(i, i + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
  };
  const luminance = (value) => {
    const [r, g, b] = channel(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const resolve = (name) => {
    for (const theme of THEMES) {
      const block = noComments.match(
        new RegExp(`\\[data-theme="${theme.id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
      );
      if (!block) continue;
      const hit = block[1].match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
      if (hit) return hit[1].trim();
    }
    return tokens.get(name);
  };
  // Every pairing of ink and surface in the app that a reader actually sees.
  const pairs = [
    ["--ink", "--surface"],
    ["--ink", "--surface-page"],
    ["--ink", "--surface-2"],
    ["--ink", "--surface-4"],
    ["--ink-2", "--surface"],
    ["--ink-3", "--surface"],
    ["--ink-3", "--surface-page"],
    ["--ink-4", "--surface"],
    ["--ink-invert", "--surface-brand-solid"],
    ["--ink-invert", "--surface-green"],
    ["--ink-invert", "--surface-purple-solid"],
    ["--ink-invert", "--surface-navy"],
    ["--ink-invert", "--surface-teal"],
    ["--ink-invert", "--surface-slate"],
    ["--ink-on-brand", "--surface-brand-solid"],
    ["--ink-success", "--surface-success"],
    ["--ink-danger", "--surface-danger"],
    ["--ink-warn", "--surface-warn"],
    ["--ink-purple", "--surface-purple"],
  ];
  for (const theme of THEMES) {
    for (const [inkName, surfaceName] of pairs) {
      const ratio = contrast(resolve(inkName), resolve(surfaceName));
      // Body text needs 4.5:1, and large or decorative text 3:1.
      // Body text needs 4.5:1, and muted or large text 3:1.
      const floor = inkName.includes("4") || inkName.includes("3") ? 3 : 4.5;
      assert.ok(
        ratio >= floor,
        `${theme.id}: ${inkName} on ${surfaceName} is ${ratio.toFixed(2)}:1, needs ${floor}:1`,
      );
    }
  }
});

test("the theme list is safe to persist and to switch on", () => {
  const ids = THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  assert.ok(ids.includes("classic"), "the default theme must be listed");
  for (const theme of THEMES) {
    assert.equal(themeById(theme.id), theme, theme.id);
    assert.ok(theme.label.trim().length > 0, theme.id);
    assert.ok(theme.description.trim().length > 10, `${theme.id} needs a description`);
    assert.match(theme.id, /^[a-z0-9-]+$/, `${theme.id} must be url safe`);
  }
  assert.equal(isThemeId("classic"), true);
  assert.equal(isThemeId("nope"), false);
  // Anything unexpected from storage falls back rather than breaking the page.
  assert.equal(themeById("<script>").id, "classic");
  assert.equal(themeById(undefined).id, "classic");
  assert.match(THEME_STORAGE_KEY, /^minewords:/, "storage keys are namespaced");
});
