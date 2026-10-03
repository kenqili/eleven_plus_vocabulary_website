// Every promise to contact a human has an address behind it.
//
// A separate file because the subject is not billing arithmetic. It is that a
// sentence on this site once said "please get in touch" and gave no address, in
// three places, one of which is shown to a parent who has just been charged and
// cannot tell whether the payment worked. A promise with no address behind it is
// not a small omission: the parent has paid, the site says nothing useful, and the
// only remaining action available to them is to pay again.
//
// The reverse also matters. An address printed in five places is five places to
// go stale, so the literal has to come from one constant and these assertions
// check that the constant is the one the owner chose.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("there is one contact address, and it is the one the owner chose", () => {
  // A literal, not a setting. See lib/contact.ts: a setting has to be set on a new
  // deployment before the site will tell a parent how to complain, and a setting
  // that is missed is a site that cannot be complained to.
  const contact = read("lib/contact.ts");
  assert.match(
    contact,
    /export const CONTACT_EMAIL = "support@11pluswords\.com"/,
    "the contact address is not the one the owner gave",
  );
  // And the mailto is derived from it rather than typed beside it, so the two
  // cannot drift.
  assert.match(
    contact,
    /export const CONTACT_MAILTO = `mailto:\$\{CONTACT_EMAIL\}`/,
    "the mailto link is not built from the address, so the two can disagree",
  );
});

test("every page that promises contact prints the address", () => {
  // Each of these is a place a parent is told to get in touch. If a promise is
  // found with no address near it, that is the bug this file exists for.
  const PROMISES = [
    ["app/about/page.tsx", /get in touch|please write to me/i],
    ["app/privacy/page.tsx", /can go to/i],
    ["components/minewords/account.tsx", /we will sort it today/],
  ];
  const missing = [];
  for (const [file, promise] of PROMISES) {
    const source = read(file);
    if (!promise.test(source)) continue;
    // The address may be written out or imported, so both count. What must not
    // happen is the promise existing with neither.
    const printed = /support@11pluswords\.com/.test(source);
    const imported = /CONTACT_EMAIL/.test(source);
    if (!printed && !imported)
      missing.push(`${file}: promises contact, shows no address`);
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

test("the address is visible text, not only a mailto link", () => {
  // A parent on a locked-down school machine may not be able to follow a
  // `mailto:`. If the address is only inside an href, they can neither click it
  // nor select and copy it, so it is printed in every one of these places.
  for (const file of ["app/about/page.tsx", "app/privacy/page.tsx"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(
      source,
      />\s*\{?(?:CONTACT_EMAIL|support@11pluswords\.com)/,
      `${file} links the address but never prints it, so it cannot be copied`,
    );
  }
});

test("a payment that has not been applied tells the parent where to write", () => {
  // The one that matters. A parent who has just been charged and sees this has
  // one question - did it work? - and needs somewhere to ask it. If the address
  // goes from this string the parent loses their only route, so it is asserted
  // through the constant rather than by matching the literal, which would pass
  // while still printing nothing if the interpolation were dropped.
  const account = read("components/minewords/account.tsx");
  const applied = account.indexOf("we will sort it today");
  assert.ok(
    applied > -1,
    "the not-applied message has gone from the account page",
  );
  const window = account.slice(Math.max(0, applied - 400), applied + 40);
  assert.match(
    window,
    /\$\{CONTACT_EMAIL\}/,
    "the not-applied message no longer names an address, so a parent who has been charged has nowhere to go",
  );
});
