// The header is the one component whose behaviour is almost entirely in the
// stylesheet, which makes it the one component where a wrong class name is
// invisible to the type checker, invisible to the linter, and completely silent
// at runtime: the element renders, the click handler fires, the state changes,
// and nothing on the page moves.
//
// That is not a hypothetical. The menu button was written as "menu-toggle"
// while every rule in the stylesheet said "header-menu-toggle", so the rule that
// hides it on a wide screen and the rule that shows it on a narrow one both
// failed to match. It was visible everywhere and did nothing anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(
  new URL("../components/minewords/header.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

/**
 * Whether a rule appears inside the stylesheet's narrow-screen block.
 *
 * The media prelude is matched as a whole on purpose. Written as
 * `@media[^{]*max-width:` the greedy `[^{]*` swallows the very "max-width: 600px"
 * the pattern is looking for, so the test silently never matches anything and
 * passes nothing at all. A test that cannot fail is worse than no test, because
 * it is read as evidence.
 */
const NARROW = /@media\s*\([^)]*max-width:\s*600px[^)]*\)\s*\{/g;

function narrow(inside) {
  const pattern = new RegExp(inside);
  let from = 0;
  for (let block = NARROW.lastIndex = 0; (block = css.indexOf("{", block)) !== -1; ) {
    const open = NARROW.lastIndex;
    // Walk forward through the block, counting braces, so a rule in a nested
    // media query does not count and a rule past the end does not either.
    let depth = 1;
    let at = block + 1;
    while (depth > 0 && at < css.length) {
      const next = css[at];
      if (next === "{") depth += 1;
      else if (next === "}") depth -= 1;
      at += 1;
      if (depth === 1 && pattern.test(css.slice(block + 1, at - 1))) return true;
    }
    block = at;
    void open;
    void from;
  }
  return false;
}

/** Class names the header puts on an element, from its className strings. */
function classNamesIn(source) {
  const names = new Set();
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const raw = match[1] ?? match[2] ?? "";
    // A template literal may interpolate; keep the literal halves so a class
    // that is half static and half conditional is still checked.
    for (const part of raw.split("${").map((chunk) => chunk.split("}")[0])) {
      for (const name of part.trim().split(/\s+/)) {
        if (name && /^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
      }
    }
  }
  return names;
}

test("every class the header uses has a rule in the stylesheet", () => {
  const missing = [...classNamesIn(header)].filter(
    (name) => !new RegExp(`\\.${name}(?![a-z0-9-])`).test(css),
  );
  assert.deepEqual(
    missing,
    [],
    `the header uses ${missing.join(", ")} and the stylesheet has no rule for ` +
      `${missing.length === 1 ? "it" : "them"}, so ${missing.length === 1 ? "it does" : "they do"} nothing`,
  );
});

test("the menu button is hidden on a wide screen and shown on a narrow one", () => {
  // The navigation is a visible row on a wide screen, so a button to open it
  // has nothing to do there. It appears only once the row collapses.
  const hide = /\.header-menu-toggle\s*\{[^}]*display:\s*none/.test(css);
  assert.ok(hide, "the menu button is never hidden, so it shows beside a visible nav");
  assert.ok(
    narrow(String.raw`.header-menu-toggle {[^}]*display:\s*(inline-flex|flex)`),
    "the menu button is never shown once the nav collapses",
  );
});

test("the collapsed navigation is actually hidden until the button is pressed", () => {
  // The button is only worth having if pressing it changes something. Both
  // halves of that are here: the closed state, and the open state that the
  // component's is-open class selects.
  assert.ok(
    narrow(String.raw`.header-links {\s*display:\s*none`),
    "the navigation does not collapse on a narrow screen",
  );
  assert.ok(
    narrow(String.raw`.header-links .account-link {\s*padding: 10px`),
    "the collapsed links get no tap target of their own",
  );
  assert.match(
    css,
    /\.header-links\.is-open\s*\{[\s\S]*?display:\s*grid/,
    "pressing the button has nothing to reveal",
  );
  // And the component applies that class.
  assert.match(
    header,
    /className=\{`header-links\$\{menuOpen \? " is-open" : ""\}`\}/,
    "the component does not add the class the stylesheet reveals",
  );
});

test("the grown-ups disclosure is a button, not a link, and says so", () => {
  // It opens a panel rather than going anywhere, so it has to be a button with
  // an expanded state. A div with a click handler would be unreachable by
  // keyboard and would say nothing to a screen reader.
  assert.match(
    header,
    /<button[\s\S]{0,200}className="account-link grown-ups-toggle"/,
    "the grown-ups disclosure is not a button",
  );
  assert.match(
    header,
    /aria-expanded=\{grownUpsOpen\}/,
    "the grown-ups disclosure does not report its state",
  );
  // And clicking it must not also close the mobile menu, which is what the
  // stopPropagation on the wrapper is for.
  assert.match(
    header,
    /className=\{`grown-ups[^`]*`\}\s*\n\s*onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
    "opening the grown-ups panel also closes the menu it sits inside",
  );
});
