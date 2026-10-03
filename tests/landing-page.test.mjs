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
const strip = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * The landing page, comments removed.
 *
 * A string rather than a function, deliberately. It was a function taking an
 * optional path, and fourteen assertions passed the *function* where a string was
 * expected — so they were matching against the stringified function, which contains
 * its own assertion messages. One of those messages names an exam board, which is
 * how a test asserting "this page never says Bond" came to fail on a page that does
 * not contain the word.
 */
const code = strip(landing);

/** Comments stripped from any other file in the repository. */
const stripped = (name) => strip(readFileSync(name, "utf8"));

test("the word count is read from the app, never typed into the copy", () => {
  // A number typed into a sales page is a number that goes stale. The page asks the
  // same endpoint the practice screen draws from and shows the answer.
  // Read on the server and handed in as a prop, so it is right for every visitor and
  // cannot be missing for a signed-out one.
  //
  // It was fetched on the client twice and wrong twice. From `/api/challenge?types=def`
  // first, whose `words` is the free-tier *question* list — so a signed-out visitor saw
  // "223 words" directly above a source list summing to 2,247. Then from
  // `/api/words`, which is `requireUser` and answers 401 to exactly the audience a
  // landing page exists for, so the page said "thousands of words" in three places.
  assert.match(
    readFileSync("app/page.tsx", "utf8"),
    /bankSize\(\)/,
    "the front page does not read the collection size from the word bank",
  );
  assert.match(
    readFileSync("app/page.tsx", "utf8"),
    /configuredFreeWordLimit\(\)/,
    "the front page does not read the free word limit from configuration",
  );
  // Checked against comment-stripped source: the prose in app/page.tsx explains that
  // this used to be fetched from `/api/words`, and naming the endpoint there is the
  // point of the comment rather than a regression.
  assert.doesNotMatch(
    stripped("app/page.tsx") + code,
    /api\/words|api\/challenge/,
    "a number on this page is fetched at runtime, which is how it came to be wrong before",
  );
  assert.match(
    code,
    /totalWords: number;/,
    "the landing page does not take the count as a prop, so it must be fetching it and can be wrong",
  );
  // And the page must not be a client component, or the number arrives after paint and
  // the page visibly changes from one figure to another.
  assert.doesNotMatch(
    landing,
    /^\s*["']use client["']/m,
    "the landing page is a client component, so the word count arrives after paint and the page changes figure in front of the reader",
  );
  assert.doesNotMatch(code, /thousands of/i);
  // There is no "before the count arrives" state any more, and that is the point:
  // the count is rendered on the server, so there is no moment at which the page
  // shows a vague phrase and then changes figure in front of the reader. Asserted
  // as an absence, because a fallback is exactly the kind of thing that gets
  // reintroduced to make a client fetch tidier.
  assert.doesNotMatch(
    code,
    /thousands of/i,
    "the page has a vague fallback for when the count is unknown, so the figure is arriving after paint",
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
  // The number is a prop rather than a literal, so the assertion checks the sentence
  // and separately that the server reads the setting the app actually uses. A
  // literal written into the page would drift from `FREE_WORD_LIMIT`.
  assert.match(
    hero,
    /keeps the \{freeWords\} easiest words/i,
    "the hero does not say what the child keeps after the trial ends",
  );
  assert.match(code, /freeWords: number;/);
  assert.doesNotMatch(
    code,
    /FREE_WORD_COUNT/,
    "the free word count is written into the page rather than passed in from configuration",
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

test("the page says where the words come from, without naming a third party", () => {
  // It used to name four publications with a count for each. Every figure was right
  // about the source files and the claim was wrong about the site: the words are
  // collected by the family who runs this and by their two sons preparing for their
  // own 11+, together with UK education sites and free resources.
  //
  // Naming third-party lists implied a licence and a curation this does not have,
  // and a parent who went looking for the book would not find a shelf of them.
  assert.match(code, /Where the words come from/i);
  assert.match(
    code,
    /our own sons/i,
    "the page does not say who collected the words",
  );
  // Whitespace-tolerant, because prettier rewraps prose and these are two-word
  // phrases that can straddle a line break. `\s+` rather than a literal space, so
  // reformatting the copy cannot fail a test that is not about formatting.
  const flat = code.replace(/\s+/g, " ");
  assert.match(flat, /UK education websites/i);
  assert.match(flat, /free\s+revision\s+resources/i);
  for (const publisher of ["Vocabulary Quest", "Blue Book", "flashcard set"]) {
    assert.doesNotMatch(
      code,
      new RegExp(publisher, "i"),
      `the page still names ${publisher} as a source, which implies a licence and a curation this does not have`,
    );
  }
});

test("the stories are the way to learn the words, and said so", () => {
  // The thing a parent will not expect, and the strongest argument on the page. It
  // needs its own section rather than a card, because a parent who skims this page
  // reads headings.
  assert.match(code, /Words are learned by meeting them/i);
  assert.match(code, /stories/i);
  assert.match(code, /funny/i, "the stories are not described as enjoyable");
  assert.match(
    code,
    /More stories are being added/i,
    "the page does not say more are coming, which is honest about what exists now",
  );
  // And it must be reachable.
  assert.match(code, /href="\/stories"/);
});

test("Practice is in the header, and Stories is not called Word Adventures", () => {
  // With `/` no longer the practice screen, nothing pointed at `/practice` — the one
  // page a child came to use would have been the only page nothing reached. It goes
  // first in the ribbon because it is the thing they came to do.
  const header = readFileSync("components/minewords/header.tsx", "utf8");
  assert.match(
    header,
    /href="\/practice"/,
    "nothing in the header points at practice",
  );
  assert.match(header, /Practice/);
  // First among the *rendered* links, so the comparison is inside the `<nav>` JSX
  // rather than across the file. The `FOR_CHILDREN` array is declared above the
  // return, so its position in the source says nothing about render order — an
  // earlier version of this test compared against it and passed for the wrong
  // reason.
  const headerFlat = header.replace(/\s+/g, " ");
  const nav = headerFlat.slice(headerFlat.indexOf("<nav"));
  const practiceAt = nav.indexOf('href="/practice"');
  const mapAt = nav.indexOf("FOR_CHILDREN.map");
  assert.ok(practiceAt > -1, "the ribbon has no link to practice");
  assert.ok(mapAt > -1, "the ribbon no longer renders the children links");
  assert.ok(
    practiceAt < mapAt,
    "Practice is not the first thing in the ribbon",
  );
  // The rename, because "Word Adventures" describes a reading game and these are
  // short stories carrying the vocabulary.
  assert.doesNotMatch(
    header,
    /Word Adventures/,
    "the stories link is still called Word Adventures",
  );
  assert.match(header, /label: "Stories"/);
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
