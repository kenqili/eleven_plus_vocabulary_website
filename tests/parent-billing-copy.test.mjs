// What a parent is told about the payment model, and when.
//
// A separate file from the billing tests because the subject is not the arithmetic.
// It is that the words on the page match what the code does - and the two were
// describing different products for a while.
//
// The failure this exists to prevent is specific and it is expensive. The site
// told parents, on the page they read *before* deciding, that access was "a
// monthly subscription" that "renews until you cancel" and that they could
// "cancel from your account in a couple of clicks". None of that was true: a
// length is bought once, there is no renewal, there is nothing to cancel, and no
// second charge. So a parent either did not buy - worried about an ongoing payment
// they would have to remember to stop - or bought and found nothing to cancel,
// which reads worse, because it reads as the site not knowing its own business.
//
// `renew` is checked in several languages because the sentence is written by hand
// in five places, and one of them being wrong is one parent being misinformed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** Everything a parent can read before or during a purchase. */
const SALES_PAGES = [
  "components/minewords/privacy-summary.tsx",
  "components/minewords/account.tsx",
  "app/privacy/page.tsx",
  "app/about/page.tsx",
  "app/how-to/page.tsx",
];

/**
 * The words a parent reads as "this bills me every month".
 *
 * Narrower than it looks. `renew`, `cancel` and `subscription` all appear in
 * sentences that *deny* the model - "it does not renew, there is nothing to
 * cancel" - and a check that flagged those would flag the fix as the bug. So it
 * matches the words only where nothing in the sentence is denying them, and
 * `recurring` is excluded outright because it is a field name from Stripe's price
 * object, not prose.
 */
const BILLING_MODEL_WORDS =
  /\b(subscription|subscribe|subscribing|renews?|renewal|premium)\b/i;
/** "There is no subscription", "nothing to cancel" - the correct sentences. */
const DENIAL =
  /\b(no|not|nothing|never|cannot|can't|does not|do not|is not)\b/i;

test("no page describes this as a subscription", () => {
  const offences = [];
  for (const file of SALES_PAGES) {
    const source = read(file);
    // Comments are the code explaining itself, and are allowed to name the old
    // model - several of them say why a sentence was changed. Only prose reaches
    // a parent.
    const prose = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const line of prose.split("\n")) {
      if (!BILLING_MODEL_WORDS.test(line)) continue;
      if (DENIAL.test(line)) continue;
      offences.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    "a parent is told this is a subscription:\n" + offences.join("\n"),
  );
});

test("the fixed-term model is stated where a parent decides", () => {
  // The absence of the wrong words is not the same as the right ones being there.
  // A page that simply stopped mentioning the price model leaves a parent with
  // nothing to hold onto, and the reason this product is a fixed term - an 11+ is
  // a dated exam, so there is nothing to renew and nothing to cancel - is the
  // whole reason a family is willing to buy.
  const summary = read("components/minewords/privacy-summary.tsx").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  assert.match(
    summary,
    /one-off payment/i,
    "the one-off payment is not stated",
  );
  assert.match(
    summary,
    /does not renew[\s\S]{0,80}nothing to cancel/i,
    "the fixed-term model is not explained on the page a parent reads before buying",
  );
  // And that buying again adds, rather than replacing, is said before the click -
  // the account page says it only to somebody who already has access, which is
  // the wrong half: the parent who has just let theirs lapse is the one who most
  // needs to know a second purchase will not waste the first.
  const account = read("components/minewords/account.tsx").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const addsSomewhere = /adds to|does not replace|added to/i.test(account);
  assert.ok(
    addsSomewhere,
    "nothing on the account page says whether buying again adds or replaces",
  );
  // In the inactive branch specifically, not only the active one.
  const inactive = account.slice(account.indexOf("billing.everPaid"));
  assert.match(
    inactive,
    /does not replace|added to/i,
    "only a parent who still has access is told that a new purchase adds to it",
  );
});

test("a lapsed paid term is never called a trial", () => {
  // `trialExpired` is `!active && !trial`, so it is true for a family whose paid
  // year has run out as well as for one whose free trial has. The page used to
  // branch on it alone and tell a parent who had paid for a year that their
  // "full-access trial has ended" - at the exact moment they came looking, and on
  // the one screen a paying parent is most anxious. Their practice page was
  // telling them the opposite, correctly, so the same parent was given two
  // different stories on two screens on the same day.
  const account = read("components/minewords/account.tsx").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  assert.doesNotMatch(
    account,
    /Your full-access trial has ended/,
    "a parent whose paid term has lapsed is told their trial ended",
  );
  // The three states are distinguished by name, so the branch cannot collapse back
  // into two.
  assert.match(
    account,
    /billing\.everPaid/,
    "a lapsed paid term is not detected",
  );
  assert.match(
    account,
    /Your access has ended/,
    "a lapsed paid term does not say the access ended",
  );
  // And it is given the date it ran until, which is the question they came with.
  const lapsed = account.slice(account.indexOf("billing.everPaid"));
  assert.match(
    lapsed.slice(0, 900),
    /date\(billing\.periodEnd\)/,
    "a lapsed paid term is not told when its access ran out",
  );
});

test("a payment confirmation is where a parent will see it", () => {
  // It used to render last on the card - below the price buttons, the purchase
  // table, the code field, the password form and the delete section. On
  // `/account?checkout=success` that put "Payment received" about a thousand
  // pixels down, so a parent who had just been charged had to scroll past "Delete
  // this account" to learn whether it had worked, with no scroll and no focus to
  // take them there. The likeliest outcome was a parent who assumed it failed and
  // pressed buy again.
  const account = read("components/minewords/account.tsx");
  const noticeAt = account.indexOf("{notice &&");
  const headingAt = account.indexOf("<h1>Your learning, saved.</h1>");
  assert.ok(noticeAt > -1, "the notice is not rendered at all");
  assert.ok(headingAt > -1, "the account heading was not found");
  assert.ok(
    noticeAt < headingAt,
    "the notice still renders below the membership card, after the delete section",
  );
  // And it is announced rather than merely polite. A polite live region waits for
  // a pause in whatever the screen reader is mid-sentence on, so a confirmation
  // arriving on a fresh page load can simply be skipped - which for the one
  // message that says "your payment worked" is the wrong trade.
  assert.match(
    account.slice(noticeAt, noticeAt + 200),
    /role="alert"/,
    "the payment confirmation is a polite live region, so it can be skipped",
  );
});

test("being told to try again does not invite a second payment", () => {
  // `lib/client/api.ts` says "check your connection and try again" for any
  // timeout. On the checkout request that is close to the worst instruction the
  // page can give: a timeout means the browser stopped waiting, not that the
  // server stopped, so the server may well have created the session - and "try
  // again" is how a parent ends up with two live sessions and two charges for one
  // intention.
  //
  // The retryable wording is still correct for everything else in this app, which
  // is reads and answers to a child's questions. So what is checked is that the
  // two cases exist and that the purchase is the one that gets the other message.
  const client = read("lib/client/api.ts");
  assert.match(
    client,
    /safeToRetry/,
    "there is no way for a caller to say that repeating its request is not safe",
  );
  // The non-retryable wording has to say the one thing that stops a parent paying
  // twice: that no money has left.
  assert.match(
    client,
    /has not been charged/i,
    "the non-retryable timeout never says the card has not been charged",
  );
  assert.doesNotMatch(
    client,
    /retryable\s*\?\s*`[^`]*try again[^`]*`\s*:\s*`[^`]*try again/,
    "both timeout messages tell the parent to try again",
  );

  // And the purchase is the caller that asks for it. Asserted against the account
  // page rather than trusted, because an option that exists and is never passed is
  // the same as not having it.
  const account = read("components/minewords/account.tsx");
  assert.match(
    account,
    /safeToRetry: false/,
    "the checkout request still describes itself as safe to repeat",
  );
  assert.doesNotMatch(
    account,
    /safeToRetry: true/,
    "a request on the account page has opted out of the safe-to-repeat wording",
  );
});
