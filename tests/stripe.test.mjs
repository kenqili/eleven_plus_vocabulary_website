// The Stripe webhook is the only route that trusts a request without a CSRF
// token or an Origin header, because Stripe is not a browser. What stands in
// place of both is a signature over the raw body. The test in security.test.mjs
// confirms the route is *wired* to that signature check by reading the source;
// this file exercises the check itself, because a signature verifier that has
// never been given a real signature is a signature verifier nobody has tested.
//
// Nothing here needs a Stripe account, a network or a database.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../lib/server/webhook.ts";

const SECRET = "whsec_test_secret";
const NOW = 1_757_000_000;
const sign = (raw, secret = SECRET, stamp = NOW) =>
  createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
const header = (raw, secret = SECRET, stamp = NOW) =>
  `t=${stamp},v1=${sign(raw, secret, stamp)}`;
const EVENT = JSON.stringify({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1" } },
});

test("a genuine signature over the raw body is accepted", () => {
  assert.equal(verifyStripeSignature(EVENT, header(EVENT), SECRET, NOW), true);
});

test("the body cannot be altered after it was signed", () => {
  // The attack this stops: take a real delivery, keep its signature header, and
  // change the subscription id inside. The signature covers the bytes, so any
  // edit invalidates it.
  const signature = header(EVENT);
  const tampered = EVENT.replace("sub_1", "sub_attacker");
  assert.notEqual(tampered, EVENT);
  assert.equal(verifyStripeSignature(tampered, signature, SECRET, NOW), false);
  // Even a single changed byte of whitespace.
  assert.equal(verifyStripeSignature(`${EVENT} `, signature, SECRET, NOW), false);
});

test("a signature made with a different secret is rejected", () => {
  assert.equal(
    verifyStripeSignature(EVENT, header(EVENT, "whsec_someone_elses"), SECRET, NOW),
    false,
  );
  // And the same signature is not accepted when the app's own secret differs.
  assert.equal(
    verifyStripeSignature(EVENT, header(EVENT), "whsec_another", NOW),
    false,
  );
});

test("a captured delivery cannot be replayed outside the five minute window", () => {
  // Stripe retries for up to three days, so a real signature is often hours old
  // by the time it is delivered. The window is deliberately short, and it
  // rejects a future timestamp as well as an old one, so a signature cannot be
  // pre-dated into the future to widen the window.
  for (const drift of [-301, 301, -3600, 86400]) {
    const stamp = NOW + drift;
    assert.equal(
      verifyStripeSignature(EVENT, header(EVENT, SECRET, stamp), SECRET, NOW),
      false,
      `a signature ${drift}s out should be rejected`,
    );
  }
  // The edge of the window is still accepted, so a slow delivery is not lost.
  for (const drift of [-300, 300, 0]) {
    const stamp = NOW + drift;
    assert.equal(
      verifyStripeSignature(EVENT, header(EVENT, SECRET, stamp), SECRET, NOW),
      true,
      `a signature ${drift}s out should be inside the window`,
    );
  }
});

test("a missing, empty or unconfigured secret never verifies", () => {
  // With no signing secret configured, anything would otherwise have to be
  // treated as a valid delivery, so this has to fail closed.
  assert.equal(verifyStripeSignature(EVENT, header(EVENT), "", NOW), false);
  assert.equal(verifyStripeSignature(EVENT, header(EVENT), undefined, NOW), false);
});

test("a malformed signature header is rejected without throwing", () => {
  // Every one of these reaches timingSafeEqual territory in a sloppier
  // implementation, which throws on a length mismatch and turns a bad request
  // into a 500. A webhook endpoint that 500s gets retried forever.
  for (const signature of [
    "",
    ",",
    "t=",
    `t=${NOW}`,
    `t=${NOW},`,
    `t=${NOW},v1=`,
    `t=${NOW},v1=short`,
    `t=${NOW},v1=${"z".repeat(64)}`,
    `t=${NOW},v1=${"0".repeat(63)}`,
    `t=${NOW},v1=${"0".repeat(65)}`,
    `v1=${sign(EVENT)}`,
    `t=notanumber,v1=${sign(EVENT)}`,
    `t=${NOW},v0=${sign(EVENT)}`,
    "t=1,v1=a=b",
  ]) {
    assert.equal(
      verifyStripeSignature(EVENT, signature, SECRET, NOW),
      false,
      `should reject ${JSON.stringify(signature)}`,
    );
  }
});

test("a rotated secret still verifies while both signatures are sent", () => {
  // During a secret rotation Stripe sends a v1 for the old secret and one for
  // the new, and a rollout that only reads the first would drop deliveries.
  const current = sign(EVENT);
  const previous = sign(EVENT, "whsec_previous_secret");
  assert.equal(
    verifyStripeSignature(
      EVENT,
      `t=${NOW},v1=${previous},v1=${current}`,
      SECRET,
      NOW,
    ),
    true,
  );
  // Order must not matter either.
  assert.equal(
    verifyStripeSignature(
      EVENT,
      `t=${NOW},v1=${current},v1=${previous}`,
      SECRET,
      NOW,
    ),
    true,
  );
});

test("the timestamp that is checked is the one inside the signed payload", () => {
  // Otherwise an attacker could put a fresh t= beside a stale signature and
  // have the freshness window measured against their own value. The HMAC covers
  // the stamp, so a mismatched stamp cannot produce a matching digest.
  const stale = NOW - 10_000;
  const forged = `t=${NOW},v1=${sign(EVENT, SECRET, stale)}`;
  assert.equal(verifyStripeSignature(EVENT, forged, SECRET, NOW), false);
});
