// Noticing when one account has paid twice for the same thing.
//
// A separate file because the subject is the opposite of the lock in
// `checkout-race.test.mjs`. That one stops the second payment page being opened.
// This one is for the case that lock cannot help with: a parent completes a
// payment, does not see the confirmation, and starts again. By the time the second
// one exists the first is a real, paid, completed purchase with its own payment
// intent, and nothing about the second is anomalous except that it is very like the
// first.
//
// The failure this prevents is silent in the worst way. The parent has paid twice,
// the app has granted twice, the account page looks perfectly healthy - two rows,
// both saying "Paid", both extending the expiry. So nobody is told anything. The
// parent finds it in their bank statement, and the reasonable conclusion is that
// the site took their money and is not giving it back.
//
// Reporting rather than refunding is deliberate and is the design. A refund moves
// money, and a duplicate is inferred from timing alone: a family who deliberately
// bought two terms to have a spare would be refunded for one without being asked.
// So this says what it noticed and offers the refund, and a person decides.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const PRICE = "price_monthly_123";
const QUARTERLY = "price_quarterly_456";
const USER = "user_1";

const workersEnv = { DB: null };
globalThis.__minewordsTestEnv = workersEnv;

let billingPromise = null;
function billingModule() {
  billingPromise ??= createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false },
    resolve: { alias: { "@": process.cwd() } },
    plugins: [
      {
        name: "minewords-test-workers-env",
        enforce: "pre",
        resolveId: (id) =>
          id === "cloudflare:workers" ? "\0workers-env" : null,
        load: (id) =>
          id === "\0workers-env"
            ? `export const env = globalThis.__minewordsTestEnv;`
            : null,
      },
    ],
  }).then((server) => {
    servers.push(server);
    return server.ssrLoadModule("/lib/server/billing.ts");
  });
  return billingPromise;
}
const servers = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

function seed(db) {
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  )
    .bind(USER, "parent@example.test", "hash", 1_700_000_000, "cus_123")
    .run();
}

/**
 * Settings plus a captured Resend.
 *
 * The capture is the point of the stub: `sendEmail` is the only outward-facing thing
 * this code does besides writing to the database, so "did the parent get told" is
 * answered by reading what would have been sent rather than by inspecting a log.
 */
function setEnv(db) {
  workersEnv.DB = db;
  for (const key of Object.keys(workersEnv))
    if (key !== "DB") delete workersEnv[key];
  Object.assign(workersEnv, {
    APP_ORIGIN: "https://minewords.test",
    STRIPE_SECRET_KEY: "sk_test_offline",
    STRIPE_PRICE_MONTHLY: PRICE,
    STRIPE_PRICE_QUARTERLY: QUARTERLY,
    STRIPE_PRICE_YEARLY: "price_yearly_789",
    STRIPE_WEBHOOK_SECRET: "whsec_offline",
    RESEND_API_KEY: "re_test_offline",
    EMAIL_FROM: "MineWords <hello@11pluswords.com>",
  });
}

/** Swallows the outbound email and records it, so nothing leaves the test. */
function captureEmail() {
  const sent = [];
  const original = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }
    return original(url, init);
  };
  return {
    sent,
    logs,
    restore() {
      globalThis.fetch = original;
      console.error = originalError;
    },
  };
}

const mine = (line) => (line.includes("Possible double charge") ? line : "");

test("a second payment for the same length within the hour tells the parent", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    assert.equal(await billing.grantPurchase("pi_first", USER, PRICE), true);
    assert.equal(
      mail.sent.length,
      0,
      "a single purchase already reported a duplicate",
    );

    assert.equal(await billing.grantPurchase("pi_second", USER, PRICE), true);

    assert.equal(
      mail.sent.length,
      1,
      "a second payment for the same length within the hour did not tell the parent",
    );
    const message = mail.sent[0];
    // `to` is a bare address string, as every other message in lib/server/email.ts
    // sends it. Compared whole rather than indexed, so this fails loudly if the
    // shape is ever an array instead of quietly comparing one character.
    assert.equal(message.to, "parent@example.test");
    assert.match(message.subject, /two payments/i);
    // The two things a parent needs: that a refund is available, and that they do
    // not have to chase it. A note that only says "we noticed" is worse than
    // silence, because it frightens them and gives them nothing to do.
    assert.match(message.text, /refund the second payment in full/i);
    assert.match(message.text, /do not need to do anything/i);
    // And an address, which is the same promise the account page makes and the one
    // that had nowhere to point.
    assert.match(message.text, /support@11pluswords\.com/);
    // Their access is untouched - this reports, it does not revoke, because
    // revoking on an unconfirmed suspicion takes away access a parent paid for.
    assert.match(message.text, /access is not affected/i);
  } finally {
    mail.restore();
    db.close();
  }
});

test("the log carries enough to refund without opening the database", async () => {
  // The log is the guaranteed half. The email can fail - and a duplicate in
  // Stripe's dashboard is a thing somebody has to see - so the line has to name
  // both payment intents, the account and the price. "Possible double charge" on
  // its own is a line somebody has to go and reconstruct.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    await billing.grantPurchase("pi_first", USER, PRICE);
    await billing.grantPurchase("pi_second", USER, PRICE);
    const line = mail.logs.map(mine).find(Boolean);
    assert.ok(line, "the duplicate was reported by email but never logged");
    for (const needed of [
      "pi_second",
      "pi_first",
      USER,
      "parent@example.test",
      PRICE,
    ]) {
      assert.ok(
        line.includes(needed),
        `the log line does not name ${needed}, so it cannot be acted on: ${line}`,
      );
    }
    // And which one to refund. It is the newer, because the earlier is the purchase
    // the parent believes they made - and getting that backwards refunds the wrong
    // payment and leaves the duplicate in place.
    assert.match(line, /"duplicatePaymentIntent":"pi_second"/);
    assert.match(line, /"originalPaymentIntent":"pi_first"/);
  } finally {
    mail.restore();
    db.close();
  }
});

test("buying a second length is not a double charge", async () => {
  // The false positive that would make this worse than useless. A family who buys
  // a month and then a year has paid twice on purpose, which is the normal way this
  // product is used, and being told we are not sure is insulting.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    await billing.grantPurchase("pi_month", USER, PRICE);
    await billing.grantPurchase("pi_quarter", USER, QUARTERLY);
    assert.equal(
      mail.sent.length,
      0,
      "buying two different lengths was reported as paying twice for the same thing",
    );
  } finally {
    mail.restore();
    db.close();
  }
});

test("a second purchase of the same length later is not a double charge", async () => {
  // Same length, but days apart. That is a family renewing early, which the account
  // page explicitly invites: "Buying again adds to the access you have".
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    await billing.grantPurchase("pi_first", USER, PRICE);
    // Backdate the first purchase by a day, which is what "later" looks like from
    // the second one's point of view.
    await db
      .prepare("UPDATE purchases SET created_at = created_at - 86400000")
      .run();
    await billing.grantPurchase("pi_second", USER, PRICE);
    assert.equal(
      mail.sent.length,
      0,
      "renewing the same length a day later was reported as a double charge",
    );
  } finally {
    mail.restore();
    db.close();
  }
});

test("a refunded first purchase is not a double charge", async () => {
  // Bought, refunded, bought again. The money for the first one came back, so
  // there is nothing outstanding and nobody has lost anything.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    await billing.grantPurchase("pi_first", USER, PRICE);
    await db
      .prepare("UPDATE purchases SET status='refunded' WHERE confirmation=?")
      .bind("pi_first")
      .run();
    await billing.grantPurchase("pi_second", USER, PRICE);
    assert.equal(
      mail.sent.length,
      0,
      "a refunded purchase was counted as a duplicate, so a parent who was refunded and rebought got an email about money that came back",
    );
  } finally {
    mail.restore();
    db.close();
  }
});

test("one payment delivered twice is not a double charge", async () => {
  // The false positive a naive implementation would produce, and the one that
  // matters most: Stripe redelivers `checkout.session.completed` for days, and
  // this is called on every delivery. If the check counted rows rather than
  // payments, ordinary webhook retries would email a parent about a double charge
  // that never happened.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  try {
    await billing.grantPurchase("pi_once", USER, PRICE);
    assert.equal(await billing.grantPurchase("pi_once", USER, PRICE), false);
    await billing.grantPurchase("pi_once", USER, PRICE);
    assert.equal(
      mail.sent.length,
      0,
      "a redelivered webhook was reported as a double charge, which would email a parent about a payment they made once",
    );
  } finally {
    mail.restore();
    db.close();
  }
});

test("a failing email never fails the payment", async () => {
  // The parent has paid and their access is committed. Failing the request here
  // would tell Stripe the webhook failed, and Stripe redelivers for three days -
  // so this would run again on every attempt, on a payment that has already been
  // applied. The access must survive the notification failing.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const mail = captureEmail();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com"))
      return new Response("nope", { status: 500 });
    return original(url, init);
  };
  try {
    // Not `assert.rejects` - the whole point is that it does not throw.
    assert.equal(await billing.grantPurchase("pi_first", USER, PRICE), true);
    assert.equal(await billing.grantPurchase("pi_second", USER, PRICE), true);
    // Both terms granted, so the parent has what they paid for.
    const row = await db
      .prepare("SELECT expiry_date FROM users WHERE id=?")
      .bind(USER)
      .first();
    assert.ok(
      row.expiry_date > Date.now(),
      "the access was lost when the email failed",
    );
    // And the failure is visible, so it is not swallowed either.
    assert.ok(
      mail.logs.some((l) =>
        l.includes("Could not report a possible double charge"),
      ),
      "a failed notification was swallowed silently",
    );
  } finally {
    globalThis.fetch = original;
    mail.restore();
    db.close();
  }
});

test("the check cannot revoke, only report", async () => {
  // Read from the source, because the property is about what the code is allowed to
  // do rather than about any one call: revoking on an unconfirmed suspicion takes
  // away access a parent paid for, and the only revocation in this app is a refund
  // Stripe has confirmed.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  const start = billing.indexOf("async function noticePossibleDoubleCharge");
  const end = billing.indexOf("async function sendDoubleChargeEmail");
  assert.ok(start > -1 && end > start, "the double-charge check was not found");
  const check = billing.slice(start, end);
  assert.doesNotMatch(
    check,
    /UPDATE users SET expiry_date/,
    "the double-charge check writes to the account, so an unconfirmed suspicion can take away paid access",
  );
  assert.doesNotMatch(
    check,
    /revokePurchase|refunds\.create|stripe\(/,
    "the double-charge check moves money on an unconfirmed suspicion",
  );
});
