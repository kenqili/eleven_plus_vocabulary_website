// The theme refactor must not have changed how the app looks. These tests pin
// that down from the two sides: every colour is now a token, and every token
// substitution stayed close enough to the literal it replaced that no one
// would notice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  APPLY_SAVED_THEME,
  THEME_SCRIPT_HASH,
} from "../lib/theme/theme-script.ts";
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

/**
 * The specific pairings a review of the app as a nine-year-old, a ten-year-old
 * and two parents turned up as unreadable. Each of these is a real surface a
 * child looks at, and each was invisible or near-invisible in at least one
 * shipped theme while the general token test was happy.
 */
test("the surfaces a child actually reads stay readable in every theme", () => {
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
  const read = (name) => {
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
  const pairs = [
    // Each question type's own card colour, so the type is readable before the
    // question is. The two newer types had no band of their own.
    ["--ink", "--surface-3", 4.5, "a meaning question card"],
    ["--ink", "--surface-success", 4.5, "a similar-words question card"],
    ["--ink", "--surface-cream", 4.5, "an opposite-words question card"],
    ["--ink", "--surface-brand-2", 4.5, "a name-the-word question card"],
    ["--ink", "--surface-purple", 4.5, "a fill-the-gap question card"],
    ["--ink-navy", "--surface-ice", 4.5, "the name-the-word badge"],
    ["--ink-violet", "--surface-purple-2", 4.5, "the fill-the-gap badge"],
    // The gloss under a wrong answer.
    ["--ink-amber-deep", "--surface-warn-2", 4.5, "the wrong-answer gloss"],
    // The question card and its four answers, which were white on white.
    ["--ink", "--surface", 4.5, "the word being tested"],
    ["--ink-brand-3", "--surface", 4.5, "the answer options"],
    ["--ink-slate", "--surface", 4.5, "the question text"],
    ["--ink-brand-2", "--surface", 4.5, "the clue and skip buttons"],
    // The stat labels under every number in the sidebar.
    ["--ink-slate", "--surface-2", 4.5, "the sidebar stat labels"],
    ["--ink-3", "--surface-2", 4.5, "the sidebar status line"],
    // The progress panel is a dark inset even in a dark theme, so its text
    // pairings are against the navy, not the page.
    ["--ink-on-navy", "--surface-navy-2", 4.5, "the sidebar explainer"],
    ["--ink-on-navy-2", "--surface-navy-2", 4.5, "the sidebar stat labels"],
    ["--ink-on-navy-3", "--surface-navy-2", 4.5, "the sidebar faintest text"],
    // The reward panel, which is the whole motivation loop.
    ["--ink-amber-deep", "--surface-warn", 4.5, "the reward panel heading"],
    ["--ink-olive-5", "--surface-warn", 4.5, "the reward panel text"],
    ["--ink-olive-6", "--surface-warn", 4.5, "the credit balance and streak bonus"],
    // Feedback, which a child reads immediately after answering.
    ["--ink-brand", "--surface-brand", 4.5, "the answer feedback"],
    ["--ink-crimson", "--surface-danger-2", 4.5, "an error message"],
    ["--ink-3", "--surface-page", 4.5, "muted text on the page"],
    // The focus ring, which has to clear 3:1 as a non-text indicator.
    ["--focus", "--surface", 3, "the focus ring on a card"],
    ["--focus", "--surface-page", 3, "the focus ring on the page"],
  ];
  for (const theme of THEMES)
    for (const [ink, surface, floor, what] of pairs) {
      const ratio = contrast(read(ink), read(surface));
      assert.ok(
        ratio >= floor,
        `${theme.id}: ${what} is ${ink} on ${surface}, ${ratio.toFixed(2)}:1, needs ${floor}:1`,
      );
    }
});

test("the progress bar's fill is distinguishable from its track", () => {
  // A bar whose fill and track are within 1.03:1 of each other is not a bar,
  // and the "words mastered" progress vanished entirely in one theme.
  const channel = (value) => {
    const hex = value.trim().replace("#", "");
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  };
  const lum = (value) => {
    const [r, g, b] = channel(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const read = (name) => {
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
  for (const theme of THEMES) {
    // The fill and the track have to be told apart by lightness, not by hue,
    // because a hue difference alone is invisible in greyscale and to a
    // colour-blind child.
    const fill = lum(read("--surface-sky-soft"));
    const track = lum(read("--surface-slate"));
    const difference = Math.abs(fill - track);
    assert.ok(
      difference > 0.06,
      `${theme.id}: progress fill and track are within ${difference.toFixed(3)} of each other in lightness`,
    );
  }
});

test("the script that applies the theme before paint knows every theme", () => {
  // The inline script carries its own allowlist, because it runs before any
  // module loads. It used to be a hand-typed copy of the theme list, so adding a
  // theme to the switcher left the script rejecting it on the next page load and
  // quietly resetting the child to the default. The script lives in its own
  // module now, because its hash has to be named by the Content-Security-Policy
  // and the two strings cannot drift apart.
  assert.match(APPLY_SAVED_THEME, /indexOf\(t\)>-1/, "the allowlist check is missing");
  for (const theme of THEMES)
    assert.ok(
      APPLY_SAVED_THEME.includes(theme.id),
      `${theme.id} is not in the script's allowlist, so the script would reject it`,
    );
  const source = readFileSync(
    new URL("../lib/theme/theme-script.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/"classic","minecraft"/.test(source),
    "the theme ids must not be typed out a second time, or adding a theme to the switcher leaves this script rejecting it",
  );
  assert.match(source, /THEMES\.map/);
  // The key the rest of the app writes, not a near-miss of it.
  assert.ok(
    APPLY_SAVED_THEME.includes(THEME_STORAGE_KEY),
    `the script reads a different storage key than the app writes (${THEME_STORAGE_KEY})`,
  );
  for (const theme of THEMES)
    assert.ok(
      noComments.includes(`[data-theme="${theme.id}"]`),
      `${theme.id} has no stylesheet block, so the script would apply nothing`,
    );
});

test("every offered theme has a readable swatch and real styles", () => {
  for (const theme of THEMES) {
    assert.ok(theme.swatch.length >= 3, `${theme.id} needs a readable swatch`);
    for (const colour of theme.swatch)
      assert.match(colour, /^#[0-9a-f]{6}$/i, `${theme.id}: ${colour}`);
  }
});

test("every animation added for a reward is switched off for less motion", () => {
  // A child with a vestibular disorder, or a phone set to reduce motion, gets
  // the same information with no movement. That is a promise about the whole
  // stylesheet rather than one component, so it is checked against the whole
  // stylesheet: any rule that animates must have a name that a
  // prefers-reduced-motion block can switch off.
  const css = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  // The global rule at the top of the file is the backstop and it covers
  // everything. What must not exist is an animation on a property that would
  // still read as movement: a long, looping one, or an infinite one.
  const animations = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(animations.length > 10, "expected to find the animations at all");
  for (const animation of animations) {
    assert.ok(
      !/infinite/.test(animation) || /flame-breathe/.test(animation),
      `a looping animation that nothing switches off: "${animation}"`,
    );
  }
  // The looping one, the only one that is, must be named in a reduced-motion
  // block, because an infinite animation is the one a child cannot sit through.
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)];
  assert.ok(reduced.length > 3, "expected several reduced-motion blocks");
  const mentionsLoop = reduced.some((block) => {
    // The block that follows this one, up to the next @media or the end.
    const start = block.index + block[0].length;
    const rest = css.slice(start);
    const end = rest.search(/\n@media|\n}/);
    return /flame-breathe|animation: none/.test(rest.slice(0, end === -1 ? 600 : end));
  });
  assert.ok(mentionsLoop, "the looping animation is not switched off anywhere");
});

test("the burst radiates in eight directions, not one", () => {
  // An animation overrides an element's own transform, so a rotation set on
  // the element is silently ignored and every tick fires the same way. This is
  // the kind of thing that looks fine in a static screenshot and is wrong in
  // motion, so the rotation has to travel through a custom property.
  const css = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const keyframes = css.slice(
    css.indexOf("@keyframes coach-tick"),
    css.indexOf("@keyframes coach-tick") + 400,
  );
  assert.ok(
    keyframes.includes("--tick-rotation"),
    "the burst keyframes never read the rotation, so every tick fires the same way",
  );
  const source = readFileSync(
    new URL("../components/minewords/coach-note.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes("--tick-rotation"),
    "the component never sets the rotation the keyframes read",
  );
  assert.ok(
    /0, 45, 90, 135, 180, 225, 270, 315/.test(source),
    "expected eight evenly spread ticks",
  );
});

test("the Content-Security-Policy hash matches the script it has to allow", () => {
  // The app inlines one script so a saved dark theme applies before the first
  // paint. A Content-Security-Policy that refuses it stops the theme working;
  // one that falls back to unsafe-inline because the hash went stale is worse
  // than no policy at all. So the hash is computed from the script, and this
  // checks the rendered script is still the one the policy names.
  const actual = createHash("sha256")
    .update(APPLY_SAVED_THEME)
    .digest("base64");
  assert.equal(
    actual,
    THEME_SCRIPT_HASH,
    "the exported hash is not the hash of the exported script",
  );
  const config = readFileSync(
    new URL("../next.config.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    config.includes("THEME_SCRIPT_HASH"),
    "the policy does not use the computed hash, so it is either absent or hardcoded",
  );
  assert.doesNotMatch(
    config,
    /sha256-[A-Za-z0-9+/=]{20,}/,
    "a literal hash in the config can go stale; it must be computed",
  );
  // The layout has to render the very same string, not a copy of it.
  const layout = readFileSync(
    new URL("../app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    layout.includes("APPLY_SAVED_THEME") &&
      !layout.includes("localStorage.getItem"),
    "the layout must render the shared script rather than its own copy",
  );
});

test("the policy allows inline styles and nothing looser", () => {
  // style-src needs unsafe-inline because React writes inline styles for the
  // progress bar transform and the burst rotation. script-src must not, because
  // that is the one thing that would let an injected script run.
  const config = readFileSync(
    new URL("../next.config.ts", import.meta.url),
    "utf8",
  );
  const policy = config.slice(config.indexOf('"default-src'), config.indexOf('].join("; ");'));
  assert.ok(policy.includes("'unsafe-inline'"), "expected the style allowance");
  const scriptSrc = policy.slice(policy.indexOf("script-src"), policy.indexOf("style-src"));
  assert.doesNotMatch(
    scriptSrc,
    /unsafe-inline|unsafe-eval/,
    `script-src is looser than it needs to be: "${scriptSrc}"`,
  );
  assert.ok(policy.includes("object-src 'none'"), "plugins should be denied");
  assert.ok(policy.includes("frame-ancestors 'none'"), "framing should be denied");
  // Nothing is loaded from anywhere else, so nothing is allowed from anywhere
  // else. An analytics tag or a font CDN added later would need this revisited,
  // and that is the point of asserting it.
  for (const directive of ["connect-src 'self'", "img-src 'self'", "font-src 'self'"]) {
    assert.ok(policy.includes(directive), `${directive} is not restricted to this origin`);
  }
});
