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

/**
 * The story library, counted the same way the app counts it.
 *
 * Read rather than imported, because `lib/server/story-library` imports
 * `cloudflare:workers` and does not load under Node. The files are JSON in a `.txt`
 * wrapper, which is why they are parsed here at all.
 */
const storyFiles = readdirSync("data/stories").filter((name) =>
  name.endsWith(".txt"),
);
const allStories = storyFiles.flatMap((name) =>
  JSON.parse(readFileSync(`data/stories/${name}`, "utf8")),
);

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

test("the price is on the page, read from Stripe, and never hard-coded", () => {
  // The section whose job is to answer "how much" used to say "at a price shown
  // before you pay anything" and send the reader to the account page. A parent who
  // has to sign in to learn the price has been asked to commit before being told
  // the cost, which is the thing that stops people buying.
  const flat = code.replace(/\s+/g, " ");

  // It is a prop, not a number in the copy. A number written here is a second source
  // of truth that can quietly disagree with what the card is charged — the same bug
  // as the word count, on the one page about money.
  assert.match(
    code,
    /priced:[\s\S]{0,220}formatted: string \| null;/,
    "the prices are not a typed-in shape, so the page has no price to show",
  );
  assert.doesNotMatch(
    flat,
    /£\s?\d/,
    "a price is written into the landing page copy, so it can disagree with Stripe",
  );

  // And the shape only means something if the server fills it from Stripe.
  assert.match(
    readFileSync("app/page.tsx", "utf8"),
    /publicPrices\(\)/,
    "the front page does not read the prices from Stripe",
  );
  assert.match(
    readFileSync("lib/server/billing.ts", "utf8"),
    /export async function publicPrices/,
    "there is no public price reader for the page to call",
  );

  // Priced rows, not a sentence: a parent in this section is comparing three
  // numbers, and a number in a run of prose is one they have to stop and parse.
  assert.match(
    code,
    /<ul className="landing-prices">/,
    "the prices are not rendered as a list of amounts",
  );
});

test("the price section degrades rather than failing", () => {
  // A third party being down must never take the front page down. It is the most
  // visited page on the site and the one a parent arrives on from a search result,
  // so a Stripe outage failing to render would turn an inconvenience into a 500 on
  // the sales page.
  //
  // Two halves to that: `publicPrices()` must not throw, and the page must have the
  // old wording to fall back to rather than an empty section.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  const reader = billing.slice(
    billing.indexOf("export async function publicPrices"),
  );

  assert.doesNotMatch(
    reader.slice(0, reader.indexOf("\n}\n")),
    /\bthrow\b/,
    "publicPrices can throw, so a Stripe outage fails the front page instead of costing the price",
  );
  // `billingReady()` gates the network calls, so a deployment with no Stripe
  // configured does not make three pointless requests per page view.
  assert.match(
    reader,
    /if \(!billingReady\(\)\) return \[\];/,
    "the price reader calls Stripe even when billing is not configured",
  );
  // A tier whose amount could not be read comes back null rather than absent, and the
  // page filters on it — so one unreadable price cannot blank the other two.
  assert.match(
    reader,
    /amount: null/,
    "an unreadable price is dropped rather than reported as unreadable",
  );

  // And the page must require *every* price to have an amount, not just one of them.
  // It first rendered the list whenever `priced.length > 0`, so with Stripe
  // unreachable it produced "for 1 month / for 3 months / for 1 year" with no
  // amounts — a shelf of three terms and no prices, which is worse than the
  // sentence it replaced: the reader is told there is a cost and not what it is.
  assert.match(
    code,
    /priced\.every\(\(price\) => price\.formatted\)/,
    "the page renders prices without checking they have amounts, so a failed lookup shows terms with no figures",
  );
  assert.doesNotMatch(
    code,
    /priced\.length > 0 \?/,
    "the page decides to show prices from how many there are rather than whether any could be read",
  );

  // And the fallback wording still exists on the page.
  const flat = code.replace(/\s+/g, " ");
  assert.match(
    flat,
    /a month, three months or a year — at a price shown before you pay anything/,
    "with no prices the page says nothing about what a term costs",
  );
});

test("the prices endpoint is public and gives away nothing", () => {
  // It has to be public: `/api/billing` is `requireUser`, and the reader who most
  // needs a price is exactly the one not signed in yet. So this is the assertion
  // that it stays public without an account, and that being public costs nothing.
  // Comment-stripped, because the module comment explains *why* this route is not
  // behind `requireUser` and names it while doing so. Reading the raw file makes a
  // true statement in a comment fail the assertion that guards the code.
  const route = stripped("app/api/prices/route.ts");
  assert.doesNotMatch(
    route,
    /requireUser/,
    "the prices endpoint requires an account, so the front page cannot show a price to a parent who has not signed in",
  );
  // No session, no customer, no email — the catalogue and nothing else.
  for (const leak of [
    "user",
    "session",
    "customer",
    "email",
    "purchase",
    "token",
  ]) {
    assert.doesNotMatch(
      route,
      new RegExp(`\\b${leak}\\b`, "i"),
      `the public prices route reads a ${leak}, which is not the catalogue`,
    );
  }
  // Only GET. It must not be possible to buy something by calling it.
  assert.doesNotMatch(
    route,
    /export async function (POST|PUT|PATCH|DELETE)/,
    "the prices endpoint accepts a write, and it should only ever be read",
  );
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

  // A word that is in the right band can still be the wrong choice to put in front
  // of a parent, and nothing else here catches that. Level 0's example was
  // `accommodate`: genuinely level 0, genuinely in the bank, and not something a
  // parent reads as "Everyday" — which is how the level labels looked mislabelled
  // before anyone had used the app.
  //
  // Asserted as a length bound rather than a banned word list, because the problem
  // is length and concreteness, not a specific word. A test that only banned
  // `accommodate` would be satisfied by swapping in the next odd word.
  const everyday = listed[0];
  assert.equal(
    everyday.name,
    "Everyday",
    "the first level is not the everyday one",
  );
  assert.ok(
    everyday.example.length <= 10,
    `"${everyday.example}" is listed as Everyday; a long Latinate word there makes the level labels look wrong to a parent who has not used the app`,
  );
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

test("what hardship access asks for is the same on every page that says", () => {
  // The landing page asked for proof of free school meals, then two sentences
  // later promised "no means test form, nothing that puts you in a position where
  // you have to prove you are struggling", and the coupon paragraph added a third
  // version. Asking and then promising not to ask is worse than either alone: it
  // teaches the reader to distrust the promise, and the reader most likely to
  // notice is the one who is actually struggling and deciding whether to ask.
  //
  // Checked across all three pages that describe it, because the failure was
  // internal disagreement rather than anything visible from outside.
  const flat = (file) => stripped(file).replace(/\s+/g, " ");
  const pages = [
    ["components/minewords/landing.tsx", "the landing page"],
    ["app/about/page.tsx", "/about"],
    ["app/privacy/page.tsx", "/privacy"],
  ];

  // Nothing may require evidence. "may" and "if you happen to" are the only
  // permitted shapes; "please provide", "you must" and a bare "share proof" as an
  // instruction are not.
  for (const [file, label] of pages) {
    assert.doesNotMatch(
      flat(file),
      /(please (send|provide)|you (must|are required to) (send|provide)|proof is required)/i,
      `${label} asks for evidence as a requirement, while another page promises never to ask`,
    );
  }

  // And the landing page must say plainly that nothing is needed, because that is
  // the promise a parent is being asked to trust.
  assert.match(
    flat("components/minewords/landing.tsx"),
    /You do not need to send any evidence/i,
    "the landing page never says outright that no evidence is required",
  );

  // "no means test" and the equivalent on /about: a claim about process, which is
  // the thing that has to be consistent.
  assert.match(
    flat("components/minewords/landing.tsx"),
    /No form, no means test, no interview/i,
    "the landing page does not promise there is no process to get through",
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

test("what the page says about each word is what the word bank actually holds", () => {
  // The sentence this checks used to read "Every word has a definition, and most
  // have synonyms, antonyms and an example sentence." Not false — but it grouped a
  // universal in with a near-universal and so made the library sound patchier than
  // it is, in the one sentence a sceptical parent reads most closely.
  //
  // Measured rather than asserted as prose, so the claim cannot drift from the data.
  const n = words.length;
  const has = (field) => words.filter((w) => w[field]?.trim()).length;
  const definition = has("definition");
  const example = has("example");
  const synonyms = has("syn");
  const antonyms = has("ant");

  // The page says both of these without qualification, so both must be universal.
  assert.equal(
    definition,
    n,
    "the page says every word has a definition, but some do not",
  );
  assert.equal(
    example,
    n,
    "the page says every word has an example sentence, but some do not",
  );

  // It says "all but a handful" about synonyms and antonyms. Measured at 98.3% and
  // 96.3%, so the loose claim holds with room to spare; a bank that lost its synonym
  // data would break it.
  assert.ok(
    synonyms / n > 0.9 && antonyms / n > 0.9,
    `the page says all but a handful have synonyms and antonyms, but it is ${((synonyms / n) * 100).toFixed(1)}% and ${((antonyms / n) * 100).toFixed(1)}%`,
  );

  // And the loose claim is not an accident of the numbers — it is what the page says.
  const flat = code.replace(/\s+/g, " ");
  assert.doesNotMatch(
    flat,
    /most have synonyms[^.]*example sentence/i,
    "the page still buries a universal next to a near-universal",
  );
  assert.match(
    flat,
    /Every one of them has a definition and a real example sentence/,
    "the page does not state that every word has a definition and an example sentence",
  );
  assert.match(
    flat,
    /All but a handful also have synonyms and antonyms/,
    "the page does not qualify the synonyms and antonyms",
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
  // Whitespace-tolerant, and wording-agnostic: the sentence was reworded when the
  // count went in ("More are being added" rather than "More stories are being
  // added"), and the point of the assertion is that the page stays honest about
  // there being more, not the exact phrasing.
  assert.match(
    code.replace(/\s+/g, " "),
    /More (stories )?are being added/i,
    "the page does not say more are coming, which is honest about what exists now",
  );
  // And it must be reachable.
  assert.match(code, /href="\/stories"/);
});

test("the page says how many stories there are, and the number is counted", () => {
  // It said only "more are being added", which a parent reads as a handful. There
  // are 120 of them, which is the strongest concrete fact the section has, and it
  // was going unsaid.
  //
  // The count is asserted against the story files rather than trusted, because the
  // whole failure this fixes is a number that is true of the data and missing from
  // the page.
  assert.ok(
    allStories.length > 100,
    "the story library is smaller than expected",
  );
  assert.match(
    code,
    /There are \{stories\} of them/,
    "the stories section does not state a count",
  );
  assert.match(
    code,
    /storyCount: number;/,
    "the count is not a prop, so it is typed into the copy and will go stale",
  );
  // Counted on the server from the same list the library is seeded from, so the page
  // cannot claim a number the site does not serve.
  assert.match(
    readFileSync("app/page.tsx", "utf8"),
    /STORY_COUNT/,
    "the front page does not read the story count from the library",
  );
  assert.match(
    readFileSync("lib/server/story-library.ts", "utf8"),
    /STORY_COUNT = stories\.length/,
    "the story count is not taken from the parsed story list",
  );
  // Whitespace-tolerant: prettier rewraps prose, and this is a phrase that can
  // straddle a line break.
  const flat = code.replace(/\s+/g, " ");
  assert.match(
    flat,
    /across all six levels/,
    "the count does not say the stories are spread across the levels, so '120' reads as 120 identical things",
  );
  // Six levels, and the page claims six in two other places.
  assert.equal(
    new Set(allStories.map((story) => story.level)).size,
    6,
    "the stories are not spread across all six levels the page claims",
  );
});

test("the stories section claims nothing the library cannot back", () => {
  // "Read the stories" leads to a real library, and the count on the page is the
  // real one. What it must not do is promise a feature the library does not have —
  // so the words a story is said to teach are checked to be words it really uses.
  const withWords = allStories.filter((story) => (story.wordIds || []).length);
  assert.equal(
    withWords.length,
    allStories.length,
    "a story carries no vocabulary, so the page's claim about meeting words in stories is not true of it",
  );
  // Every word a story uses is a real word in the bank, or the hover-over hint
  // offers a parent a definition that does not exist.
  const known = new Set(words.map((word) => word.id));
  const unknown = new Set(
    withWords.flatMap((story) =>
      (story.wordIds || []).filter((id) => !known.has(id)),
    ),
  );
  assert.deepEqual(
    [...unknown],
    [],
    `stories reference words that are not in the bank: ${[...unknown].slice(0, 5).join(", ")}`,
  );
});

test("nothing on the site is still called Word Adventures", () => {
  // The rename to "Stories" was applied to the nav and left everywhere else, so a
  // parent clicked "Stories" and landed on a page whose heading, browser tab, back
  // link and error message all said "Word Adventures" — which reads as two features.
  const files = [
    "app/stories/page.tsx",
    "app/api/stories/route.ts",
    "components/minewords/story-library.tsx",
    "components/minewords/story-reader.tsx",
    "components/minewords/learning-calendar.tsx",
    "components/minewords/header.tsx",
  ];
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /Word Adventures/,
      `${file} still calls the stories "Word Adventures"`,
    );
  }
  // And the name it does use is consistent, including in the browser tab.
  assert.match(
    readFileSync("components/minewords/story-library.tsx", "utf8"),
    /<h1>Stories<\/h1>/,
    "the stories page heading is not simply 'Stories'",
  );
  assert.match(
    readFileSync("app/stories/page.tsx", "utf8"),
    /title: "Stories \| MineWords"/,
    "the stories page title is not renamed, so the search result and the tab say the old name",
  );
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
