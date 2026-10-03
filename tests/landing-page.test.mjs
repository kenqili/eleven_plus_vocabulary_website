// The front page: what it says, and what it must not say.
//
// A separate file because the subject is claims rather than behaviour. This page
// sells something to parents, and the failure mode is specific: a sentence that is
// technically about the right subject but overstates it. The 409 work and the
// coupon work were both about a parent being told something untrue; this is the
// third place that can happen, and it is the one with the most reach.
//
// Two rules, and they pull against each other on purpose:
//
//   1. Say what the app actually contains. The word count comes from the app at
//      runtime, never typed into the copy, so the page cannot drift away from the
//      product.
//   2. Do not claim exam-board coverage that has not been verified. There is no
//      Bond, GL or CEM reference anywhere in the word bank and no per-board
//      past-paper alignment, so naming a board would be a claim about somebody
//      else's product that nothing here supports. In the UK that is the kind of
//      advertising a parent can complain about, and the complaint is what makes it
//      expensive rather than the sentence itself.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { words } from "../scripts/load-word-bank.mjs";

const landing = readFileSync("components/minewords/landing.tsx", "utf8");
/** Comments stripped, so prose about a rule cannot satisfy the rule. */
const code = landing
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("the word count is read from the app, never typed into the copy", () => {
  // A number typed into a sales page is a number that goes stale. The page asks the
  // same endpoint the practice screen draws from and shows the answer.
  // `/api/words`, not `/api/challenge`. The challenge endpoint's `words` array is a
  // set of *questions* drawn from the free tier, so reading the count from it showed
  // a signed-out visitor — which is every visitor — "223 words" directly above a
  // source list that sums to 2,247. `collection` is the whole bank, and it is sent
  // for both the signed-out and signed-in cases.
  assert.match(
    code,
    /api<[^>]*>\("\/api\/words"\)/,
    "the landing page does not read the word count from the app",
  );
  assert.match(code, /setCount\(result\.collection\)/);
  assert.doesNotMatch(
    code,
    /api\/challenge\?types=def/,
    "the count is read from the challenge endpoint, whose `words` is the free-tier question list rather than the collection",
  );
  // And until it is known it says "thousands of", rather than a guess. A missing
  // figure is fine on a sales page; a wrong one is the thing that cannot be fixed
  // once a parent has read it.
  assert.match(
    code,
    /count === null \? "thousands of"/,
    "before the count arrives the page does not fall back to a vague phrase",
  );
  // No hardcoded total anywhere in the prose.
  assert.doesNotMatch(
    code,
    /\b(1|2|3|4|5|6|7|8|9),\d{3}\s*(?:words|vocabulary)/i,
    "a word count is written into the copy, where it will disagree with the app eventually",
  );
});

test("it claims no exam-board coverage", () => {
  // The one thing that must not appear. There is no Bond, GL or CEM reference in
  // the word bank and no alignment to any board's past papers, so naming one is a
  // claim about a third party's product that nothing in this repository supports.
  //
  // Checked against the word bank too, so the assertion cannot be satisfied by the
  // page and contradicted by the data: if a board ever appears in the content, this
  // fails and someone has to make a decision rather than the page quietly claiming
  // it.
  for (const board of ["Bond", "GL Assessment", "CEM"]) {
    assert.doesNotMatch(
      code,
      new RegExp(board.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      `the landing page names ${board}, which is not a claim this app can support`,
    );
  }
  // And nothing in the content does either, which is what makes the above true.
  const sources = new Set(words.map((w) => w.source));
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /bond|gl assessment|cem/i,
      `the word bank names an exam board in "${source}", so the board claim is not unfounded`,
    );
  }
});

test("it says what is not covered, in its own section", () => {
  // Maths and NVR are genuinely out of scope. A parent who finds that out after
  // paying feels misled even if it was never claimed, so it is stated plainly, in
  // its own headed section, rather than left to be discovered.
  assert.match(
    code,
    /What this does not cover/,
    "there is no section saying what the app does not do",
  );
  assert.match(code, /Maths and non-verbal reasoning are not covered/i);
  assert.match(
    code,
    /landing-scope/,
    "the scope section is not visually distinct",
  );
});

test("the free trial, the price and the fact it is not a subscription are all there", () => {
  // A parent deciding cannot do it without these three, and the third is the one
  // the site got wrong for weeks: it used to say "it renews until you cancel" for a
  // product that does not renew and cannot be cancelled.
  assert.match(code, /7 days|no card needed/i);
  // Two sentences, both needed: the model (one-off) and its consequence (no renewal,
  // nothing to cancel). The second is the one the site got wrong for weeks, and a
  // parent who expects an ongoing charge does not buy.
  assert.match(
    code,
    /one-off payment/i,
    "the landing page does not say the payment is one-off",
  );
  // Asserted as the two facts rather than as the whole sentence between them,
  // because prettier rewraps prose and a test that pins a line break fails when
  // somebody reformats the file without changing a word.
  assert.match(
    code,
    /does not renew/i,
    "the landing page does not say the payment does not renew",
  );
  assert.match(
    code,
    /nothing\s+to cancel/i,
    "the landing page does not say there is nothing to cancel",
  );
  assert.match(code, /will not charge you again/i);
});

test("the hardship route is on this page, not only on /about", () => {
  // Somebody who cannot pay has usually already decided this is not for them. If
  // the offer is on another page they have to go and find it, and they do not, so
  // it is here as well - with the address, because a promise with no address
  // behind it is the failure that was just fixed elsewhere on the site.
  assert.match(code, /if money is the problem/i);
  assert.match(code, /free school meals/i);
  assert.match(
    code,
    /support@11pluswords\.com/,
    "the hardship section gives no address, so a parent who needs it has nowhere to write",
  );
});

test("every difficulty example is a real word at the level claimed", () => {
  // The single most checkable claim on the page, and the first draft got it wrong:
  // four of the six examples were in the wrong band, `abandon` and `accommodate`
  // were the wrong way round, and `sesquipedalian` was not in the product at all.
  //
  // A parent types the example into the app to see whether it is real, and the
  // whole value of this page is that it can be checked. So every example is read
  // out of the bank here and matched against the difficulty band it is listed
  // under — which is the assertion the copy had to pass and did not.
  const bank = JSON.parse(
    readFileSync(
      "public/bank/" +
        readdirSync("public/bank").find((f) => f.startsWith("bank-full")),
      "utf8",
    ),
  );
  // The bank stores each word as a positional array; index 0 is the word and
  // index 5 is its difficulty level.
  const LEVEL_NAMES = [
    "Everyday",
    "Common",
    "Less common",
    "Uncommon",
    "Literary",
    "Rare",
  ];
  const listed = [
    ...code.matchAll(/\{ name: "([^"]+)", example: "([^"]+)" \}/g),
  ].map((m) => ({ name: m[1], example: m[2] }));
  assert.equal(
    listed.length,
    6,
    "the page should show one example for each of the six difficulty levels",
  );
  for (const { name, example } of listed) {
    const row = bank.words.find(
      (r) => r[0].toLowerCase() === example.toLowerCase(),
    );
    assert.ok(
      row,
      `"${example}" is used as the example for "${name}" but is not in the word bank, so a parent who searches for it gets nothing`,
    );
    assert.equal(
      LEVEL_NAMES[row[5]],
      name,
      `"${example}" is listed as "${name}" but the bank has it at level ${row[5]} (${LEVEL_NAMES[row[5]]})`,
    );
  }
});

test("the source names and counts match the word bank", () => {
  // The one part of the page that was right first time, and it is the part a parent
  // will hold against a book on their table — so it is checked against the bank
  // rather than trusted.
  const counts = {};
  for (const word of words)
    counts[word.source] = (counts[word.source] || 0) + 1;
  assert.equal(counts.vocabquest, 1384);
  assert.equal(counts.blue_book, 547);
  assert.equal(counts.flash_card_1 + counts.flash_card_2, 200);
  assert.equal(counts.curriculum, 116);
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    words.length,
  );
  // The curriculum source is 116 words and is not the national word list. Calling it
  // that is a claim about somebody else's document that is not true.
  assert.doesNotMatch(
    code,
    /national curriculum word list/i,
    "the curriculum source is described as the national word list, which 116 words is not",
  );
});

test("it does not contradict the site's own honest pages", () => {
  // The worst kind of dishonesty is internal. `/info` explicitly refuses two claims
  // this page used to make: that vocabulary wins the 11+, and that there is a shared
  // board syllabus. The landing page links to `/info` three lines from the bottom, so
  // a parent who checks finds the site disagreeing with itself.
  assert.doesNotMatch(
    code,
    /the part of the paper that decides the score|syllabus used by all boards/i,
    "the landing page claims what /info explicitly calls a sales tactic",
  );
  // And it must not promise a feature that does not exist. A parent who presses
  // "see which words are due today" and finds a study-time heatmap has been misled.
  assert.doesNotMatch(code, /words are due today/i);
  // Streaks are consecutive correct answers, not days - a design decision
  // documented in docs/progress-and-rewards-design.md, and there is no mechanic that
  // brings a child back tomorrow.
  assert.doesNotMatch(code, /come back tomorrow/i);
});

test("it says what happens after the trial, in the hero", () => {
  // The drop from every word to the free set is the thing a parent finds out on day
  // eight, and finding it out feels like being sold to. Told in the hero, it reads as
  // honesty. The account page also says it; this is about being told early.
  const hero = code.slice(0, code.indexOf("What the 11+ actually asks for"));
  // The number is a JSX interpolation of a named constant rather than a literal, so
  // the assertion checks the constant and the sentence around it separately. A
  // literal would drift from `FREE_WORD_LIMIT`, which is the number the app uses.
  assert.match(
    hero,
    /keeps the \{FREE_WORD_COUNT\} easiest words/i,
    "the hero does not say what the child keeps after the trial ends",
  );
  assert.match(code, /const FREE_WORD_COUNT = 224/);
  assert.doesNotMatch(
    code,
    /const FREE_WORD_COUNT = (?!224)\d+/,
    "the free word count on the page is not the 224 the app actually grants",
  );
  assert.match(hero, /Nothing is deleted/i);
  // And the facts a parent asks for before paying rather than after.
  for (const [label, pattern] of [
    ["one account is one child", /one account is one child/i],
    ["nothing to install", /nothing to install/i],
    ["session length", /twenty questions/i],
    ["adding your own words", /add the words from your own book/i],
  ]) {
    assert.match(code, pattern, `the page does not say ${label}`);
  }
});

test("the page a parent decides on has a footer with the privacy notice", () => {
  // Every other page renders `.site-footer`. This one did not, which meant the
  // single page where somebody decides whether to enter card details was also the
  // only page without a privacy link on it.
  assert.match(code, /<footer className="site-footer">/);
  const footer = code.slice(code.indexOf('<footer className="site-footer">'));
  assert.match(footer, /\/privacy/);
  assert.match(footer, /support@11pluswords\.com/);
});

test("print and the mistakes list are both offered", () => {
  // These are the two features most likely to be what a parent pays for, and both
  // are free - which is a differentiator worth stating rather than hiding.
  assert.match(code, /\/words\/print/);
  assert.match(code, /\/words\b/);
  assert.match(
    code,
    /print exactly the words your child gets wrong|words your child gets wrong/i,
    "the mistakes list is not offered, which is the strongest reason to buy",
  );
  // "Free to print on every account" was true-sounding and false:
  // `/api/words/export` answers 402 to an account whose access has ended, so a lapsed
  // free account cannot print a single word. The claim is now the true one, and the
  // test pins the qualification so it cannot be dropped to make the sentence punchier.
  assert.match(code, /free while your access is running/i);
  assert.doesNotMatch(
    code,
    /free on every account|free to print, and no restrictions/i,
    "the page claims printing is unrestricted, which the export route refuses with a 402",
  );
  // And the page must not contradict what the code does. Checked against the route,
  // so the copy cannot drift from the paywall it describes.
  const exportRoute = readFileSync("app/api/words/export/route.ts", "utf8");
  assert.match(
    exportRoute,
    /membership\(user\)\)\.access/,
    "the export route no longer gates on access, so the page could claim printing is free again",
  );
});

test("every internal link on the page is one that exists", () => {
  // A dead link on a sales page is the whole page failing. Checked against the app
  // directory rather than a hand-kept list, so a page that has been renamed cannot
  // leave a link pointing at nothing.
  const routes = new Set(["/"]);
  // One level and two, which is all this site has. Walked rather than hand-kept, so
  // a page that gets renamed leaves a dead link here rather than in production.
  const appDir = "app";
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = `${appDir}/${entry.name}`;
    if (!existsSync(`${dir}/page.tsx`)) continue;
    routes.add(`/${entry.name}`);
    for (const sub of readdirSync(dir, { withFileTypes: true })) {
      if (sub.isDirectory() && existsSync(`${dir}/${sub.name}/page.tsx`)) {
        routes.add(`/${entry.name}/${sub.name}`);
      }
    }
  }
  const linked = [...code.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
  const dead = linked.filter((href) => !routes.has(href));
  assert.deepEqual(
    dead,
    [],
    `the landing page links to pages that do not exist: ${dead}`,
  );
});

test("the practice screen moved and everything that means 'practise' went with it", () => {
  // `/` used to BE the practice screen. Everything that sent a parent or child to
  // "go and practise" has to point at the new URL, and the one that must not move
  // is the brand in the header - a parent who has just arrived and wants to know
  // what the site is should land on the page that tells them.
  assert.match(
    readFileSync("app/practice/page.tsx", "utf8"),
    /from "@\/components\/minewords\/challenge"/,
    "/practice does not render the practice screen",
  );
  assert.match(
    readFileSync("app/page.tsx", "utf8"),
    /from "@\/components\/minewords\/landing"/,
    "the front page is not the landing page",
  );
  // The header brand stays on the front page.
  const header = readFileSync("components/minewords/header.tsx", "utf8");
  assert.match(
    header,
    /className="brand" href="\/"/,
    "the brand no longer points at /",
  );
  // And nothing that says "practise" is left pointing at the landing page, which
  // would put a child on a sales page.
  for (const file of [
    "app/about/page.tsx",
    "app/how-to/page.tsx",
    "app/info/page.tsx",
    "components/minewords/word-summary.tsx",
    "components/minewords/rewards.tsx",
    "components/minewords/account.tsx",
    "components/minewords/daily-mission.tsx",
    "components/minewords/learning-calendar.tsx",
    "components/minewords/reset-password.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const goingHome = [...source.matchAll(/href="\/"[^>]*>\s*([^<{]{0,60})/g)]
      .map((m) => m[1])
      .filter((label) =>
        /practise|practice|challenge|start|free round|questions|words/i.test(
          label,
        ),
      );
    assert.deepEqual(
      goingHome,
      [],
      `${file} sends a parent to the landing page with the label "${goingHome[0]}"`,
    );
  }
});
