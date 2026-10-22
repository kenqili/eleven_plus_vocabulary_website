/**
 * The parent tips: what they are, and how they are offered.
 *
 * These are words on a screen, so the thing worth testing is not the wording
 * but the rules around it: that every tip points at something the app can
 * actually do, that a tip is offered once, and that the next one comes after
 * it rather than beside it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nextTip,
  TIP_AFTER_ANSWERS,
  USAGE_TIPS,
} from "../lib/client/usage-tips.ts";

test("every tip is a tip, and every tip points somewhere real", () => {
  assert.ok(USAGE_TIPS.length >= 5, "there is not enough advice to be worth a banner");
  const ids = new Set();
  for (const tip of USAGE_TIPS) {
    assert.equal(typeof tip.id, "string");
    assert.ok(tip.id.length > 0, "a tip has no id");
    assert.equal(ids.has(tip.id), false, `two tips share the id "${tip.id}"`);
    ids.add(tip.id);
    assert.ok(tip.title.length > 0, `the tip "${tip.id}" has no title`);
    assert.ok(tip.text.length > 20, `the tip "${tip.id}" says nothing`);
    // A tip that points at a page must say what the page is called, and a
    // tip that goes nowhere must not pretend to.
    if (tip.href) assert.ok(tip.linkText, `the tip "${tip.id}" has a link with no words`);
    else assert.equal(tip.linkText, undefined, `the tip "${tip.id}" has words with no link`);
  }
});

test("the links in the tips lead to pages that exist", () => {
  // The pages the app actually serves. A tip pointing at a page that was
  // renamed is a tip that sends a parent to a 404.
  const pages = [
    "app/words/page.tsx",
    "app/words/map/page.tsx",
    "app/words/manage/page.tsx",
    "app/words/print/page.tsx",
    "app/rewards/page.tsx",
    "app/calendar/page.tsx",
    "app/stories/page.tsx",
    "app/five-letters/page.tsx",
  ];
  for (const page of pages) {
    assert.ok(readFileSync(page, "utf8").length > 0, `${page} is empty`);
  }
  for (const tip of USAGE_TIPS) {
    if (!tip.href) continue;
    const file = `app${tip.href}/page.tsx`;
    assert.ok(
      readFileSync(file, "utf8").length > 0,
      `the tip "${tip.id}" points at ${tip.href}, which has no page`,
    );
  }
});

test("a tip is offered once, and the next one comes after it", () => {
  const first = nextTip([]);
  assert.ok(first, "the first tip was not offered");
  assert.equal(first.id, USAGE_TIPS[0].id);
  // A tip that has been seen is not offered again, and the one after it is.
  const second = nextTip([first.id]);
  assert.ok(second, "the second tip was not offered");
  assert.equal(second.id, USAGE_TIPS[1].id);
  // Once they have all been seen, there is nothing left to offer rather than
  // a tip that repeats.
  assert.equal(
    nextTip(USAGE_TIPS.map((tip) => tip.id)),
    null,
  );
});

test("a tip waits until the child has settled in", () => {
  // Not on the first question: a parent reading a banner while their child
  // is still finding the buttons is a parent not reading it.
  assert.ok(TIP_AFTER_ANSWERS >= 2, "a tip arrives before the child has settled");
});
