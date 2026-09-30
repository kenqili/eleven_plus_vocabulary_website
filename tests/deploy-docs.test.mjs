/**
 * Every environment secret the code reads must appear in the deploy guide.
 *
 * This exists because of a specific, unhelpful failure: a deployment made by
 * following `docs/DEPLOY.md` had no `RESEND_API_KEY` and no `EMAIL_FROM`, so
 * password reset silently did nothing. The endpoint answers "if that address has
 * an account, a reset link is on its way" either way, which is the right behaviour
 * and the reason nobody noticed - the only symptom was a parent who never received
 * anything, and the reason was in a log nobody was reading.
 *
 * `.env.example` listed both. The deploy guide did not, and the deploy guide is
 * the one a person follows when putting the site up. A secret that only appears
 * in the example file is, in practice, a secret that is not set.
 *
 * The test is on the *documentation*, not the behaviour, because the behaviour is
 * deliberately indistinguishable: that is the whole design of the endpoint. What can
 * be checked is whether someone setting the site up would be told.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

/** Settings with a working default, which the guide documents as optional. */
const OPTIONAL = new Set([
  "FREE_TRIAL_DAYS",
  "FREE_WORD_LIMIT",
  // Pricing is expressed in pence for the mission display and has a default; the
  // Stripe price id is what actually decides what a parent is charged.
  "MONTHLY_PRICE_PENCE",
  "SUBSCRIPTION_PRICE_PENCE",
]);

/** Every `setting("NAME")` the app reads, found in the source. */
function settingsTheCodeReads() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !path.includes("/api/")) {
        files.push(path);
      }
    }
  };
  walk("lib");
  const names = new Set();
  for (const file of files)
    for (const match of readFileSync(file, "utf8").matchAll(
      /setting\("([A-Z_]+)"\)/g,
    ))
      names.add(match[1]);
  return names;
}

const guide = readFileSync("docs/DEPLOY.md", "utf8");

test("every secret the code reads is in the deploy guide", () => {
  const undocumented = [];
  for (const name of settingsTheCodeReads()) {
    if (OPTIONAL.has(name)) continue;
    // Named as a command to set it, rather than merely mentioned: a name in
    // prose is easy to write and easy to miss when following the steps.
    if (!new RegExp(`secret put ${name}\\b`).test(guide))
      undocumented.push(name);
  }
  assert.deepEqual(
    undocumented,
    [],
    `the code reads these but docs/DEPLOY.md never tells you to set them: ${undocumented.join(", ")}. ` +
      `A missing secret fails silently wherever the failure is invisible to a caller, which is most places.`,
  );
});

test("the guide's secret list is not stale", () => {
  // The other direction. A command in the guide for a setting nothing reads is
  // either a leftover or a rename that was not finished, and both send someone
  // looking for a variable that does not exist.
  const commands = [...guide.matchAll(/secret put ([A-Z_]+)/g)].map(
    (m) => m[1],
  );
  const read = settingsTheCodeReads();
  const stale = commands.filter((name) => !read.has(name));
  assert.deepEqual(
    stale,
    [],
    `the guide tells you to set these but no code reads them: ${stale.join(", ")}`,
  );
});

test("the sender address is documented as needing a verified domain", () => {
  // Resend returns 403 for a sender on an unverified domain, with a perfectly
  // valid key. That is a confusing way to discover the requirement, and it is the
  // most likely second failure after a missing key.
  assert.match(
    guide,
    /EMAIL_FROM[\s\S]{0,400}verif/i,
    "EMAIL_FROM must be documented as needing a verified sending domain, or a valid key still gets 403",
  );
});
