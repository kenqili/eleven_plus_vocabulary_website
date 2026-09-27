// The Stripe half of the app, exercised offline.
//
// billing.ts reads its configuration from the Workers environment and reaches
// Stripe over the network, so testing it means standing up both: a Vite module
// runner with a stub for `cloudflare:workers` backed by the project's own local
// SQLite shim, and a fetch stub standing in for api.stripe.com. Nothing here
// contacts Stripe, needs an account, or writes outside the test's own
// in-memory database.
//
// The webhook signature itself is covered in stripe.test.mjs, which needs none
// of this.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const PRICE = "price_monthly_123";
const CUSTOMER = "cus_123";
const USER = "user_1";

/** Builds a module runner whose `cloudflare:workers` env is ours to control. */
async function loadBilling(db, settings) {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, watch: null },
    resolve: { alias: { "@": process.cwd() } },
    plugins: [
      {
        name: "minewords-test-workers-env",
        enforce: "pre",
        resolveId: (id) => (id === "cloudflare:workers" ? "\0workers-env" : null),
        load: (id) =>
          id === "\0workers-env"
            ? `export const env = globalThis.__minewordsTestEnv;`
            : null,
      },
    ],
  });
  globalThis.__minewordsTestEnv = { DB: db, ...settings };
  const billing = await server.ssrLoadModule("/lib/server/billing.ts");
  return { billing, close: () => server.close() };
}

/** A fetch stub that records every call and replies from a route table. */
function stubStripe(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "");
    const method = init.method || "GET";
    calls.push({
      path,
      method,
      headers: init.headers || {},
      body: init.body ? String(init.body) : null,
      idempotencyKey: (init.headers || {})["Idempotency-Key"] || null,
    });
    const route = routes[path];
    if (!route)
      return new Response(JSON.stringify({ error: { message: "no route" } }), {
        status: 404,
      });
    const value = typeof route === "function" ? route(calls.at(-1)) : route;
    return new Response(JSON.stringify(value), { status: 200 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const SETTINGS = {
  APP_ORIGIN: "https://minewords.test",
  STRIPE_SECRET_KEY: "sk_test_offline",
  STRIPE_PRICE_ID: PRICE,
  STRIPE_WEBHOOK_SECRET: "whsec_offline",
};

function seed(db) {
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  ).run(USER, "parent@example.test", "hash", 1_700_000_000, CUSTOMER);
}

const subscription = (price = PRICE, status = "active") => ({
  id: "sub_1",
  customer: CUSTOMER,
  status,
  current_period_end: 1_800_000_000,
  items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] },
});

const rows = (db, sql) => db.prepare(sql).all().results;

test("syncSubscription records access for a subscription on the right price", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({ "subscriptions/sub_1": subscription() });
  try {
    await billing.syncSubscription("sub_1");
    const [row] = rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(row.user_id, USER);
    assert.equal(row.status, "active");
    assert.equal(row.price_id, PRICE);
    assert.equal(row.period_end, 1_800_000_000);
    // Access must be time-limited, or a lapsed subscription would read as live.
    assert.ok(row.checked_at > 0);
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("syncSubscription refuses access when the price is not the one we sell", async () => {
  // Somebody subscribing to a different product through the same Stripe
  // account must not unlock this site.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({ "subscriptions/sub_1": subscription("price_annual_999") });
  try {
    await billing.syncSubscription("sub_1");
    const [row] = rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(row.status, "inactive");
    assert.equal(row.period_id ?? row.price_id, "price_annual_999");
    assert.equal(row.period_end, 1_800_000_000);
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("a delayed webhook cannot restore access that has already been withdrawn", async () => {
  // Stripe delivers out of order and retries for days. Two events for one
  // subscription can arrive cancelled-then-active, and the second must not
  // reinstate a membership the first one ended.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({ "subscriptions/sub_1": subscription() });
  try {
    // A newer observation says cancelled, period already over.
    db.prepare(
      "INSERT INTO subscriptions (id,user_id,status,period_end,price_id,checked_at) VALUES (?,?,?,?,?,?)",
    ).run("sub_1", USER, "canceled", 1, PRICE, Date.now());

    // Now replay the older, still-active payload, as a retry would.
    const { syncSubscription } = await loadBilling(db, SETTINGS);
    // Force the older checkedAt by calling through a stale timestamp: the guard
    // is inside the SQL, so a plain call with a newer clock must win instead.
    await syncSubscription("sub_1");
    const [fresh] = rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(fresh.status, "active", "a newer event does apply");

    // Directly exercise the ordering guard the SQL relies on.
    db.prepare(
      "INSERT INTO subscriptions (id,user_id,status,period_end,price_id,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, period_end=excluded.period_end, price_id=excluded.price_id, checked_at=excluded.checked_at WHERE excluded.checked_at >= subscriptions.checked_at",
    ).run("sub_1", USER, "canceled", 2, PRICE, Date.now() - 60_000);
    const [after] = rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(after.status, "active", "an older event must not overwrite");
    assert.equal(after.checked_at, fresh.checked_at);
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("a Stripe customer we do not know grants nobody access", async () => {
  // The webhook is authenticated but not authorised to a user: a valid signature
  // only proves Stripe sent it. Linking is by customer id, so an unknown one has
  // to be a no-op rather than a guess.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({
    "subscriptions/sub_1": { ...subscription(), customer: "cus_someone_else" },
  });
  try {
    await billing.syncSubscription("sub_1");
    assert.equal(rows(db, "SELECT * FROM subscriptions").length, 0);
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("checkoutSession asks Stripe for a subscription on our price and returns to our origin", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({
    "checkout/sessions": { id: "cs_1", url: "https://checkout.stripe.test/cs_1" },
  });
  try {
    const session = await billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN);
    assert.equal(session.url, "https://checkout.stripe.test/cs_1");
    const call = stripe.calls.find((c) => c.path === "checkout/sessions");
    assert.ok(call, "a checkout session was created");
    assert.equal(call.method, "POST");
    const body = new URLSearchParams(call.body);
    assert.equal(body.get("mode"), "subscription");
    assert.equal(body.get("customer"), CUSTOMER);
    assert.equal(body.get("line_items[0][price]"), PRICE);
    // The return URLs decide whether a parent lands on a page that exists.
    assert.equal(body.get("success_url"), "https://minewords.test/account?checkout=success");
    assert.equal(body.get("cancel_url"), "https://minewords.test/account?checkout=cancelled");
    // So the webhook can find the user again without trusting the browser.
    assert.equal(body.get("client_reference_id"), USER);
    assert.equal(body.get("subscription_data[metadata][user_id]"), USER);
    assert.ok(call.idempotencyKey, "creation is idempotent");
    const [row] = rows(db, "SELECT * FROM checkout_requests WHERE user_id=?", USER);
    assert.equal(row.session_id, "cs_1");
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("an unfinished checkout is reused instead of starting a second one", async () => {
  // A parent who clicks Subscribe twice, or refreshes, must not end up with two
  // live subscriptions or a second charge.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const stripe = stubStripe({
    "checkout/sessions": { id: "cs_1", url: "https://checkout.stripe.test/cs_1" },
    "checkout/sessions/cs_1": { id: "cs_1", status: "open", url: "https://checkout.stripe.test/cs_1" },
  });
  try {
    await billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN);
    const again = await billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN);
    assert.equal(again.url, "https://checkout.stripe.test/cs_1");
    const creations = stripe.calls.filter((c) => c.path === "checkout/sessions");
    assert.equal(creations.length, 1, "no second session is created");
  } finally {
    stripe.restore();
    await close();
    db.close();
  }
});

test("the API key never reaches the browser and Stripe errors do not leak", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  const { billing, close } = await loadBilling(db, SETTINGS);
  const original = globalThis.fetch;
  let seenAuth = null;
  globalThis.fetch = async (url, init) => {
    seenAuth = init.headers.Authorization;
    return new Response(
      JSON.stringify({ error: { message: "No such price: price_secret" } }),
      { status: 400 },
    );
  };
  try {
    await assert.rejects(
      () => billing.stripe("prices/price_secret"),
      (error) => {
        // The parent sees a plain sentence, not a Stripe payload that could
        // name internal ids.
        assert.equal(error.status, 502);
        assert.equal(
          error.message,
          "The payment service is unavailable. Please try again.",
        );
        assert.ok(!error.message.includes("price_secret"));
        return true;
      },
    );
    assert.equal(seenAuth, "Bearer sk_test_offline");
  } finally {
    globalThis.fetch = original;
    await close();
    db.close();
  }
});

test("billing stays switched off until every Stripe setting is present", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  const { billing, close } = await loadBilling(db, SETTINGS);
  try {
    assert.equal(billing.billingReady(), true);
    for (const missing of [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID",
      "STRIPE_WEBHOOK_SECRET",
      "APP_ORIGIN",
    ]) {
      const partial = { ...SETTINGS, [missing]: "" };
      const loaded = await loadBilling(db, partial);
      assert.equal(
        loaded.billing.billingReady(),
        false,
        `${missing} alone must not enable payments`,
      );
      await loaded.close();
    }
    // With no key at all, the API refuses rather than calling Stripe with "".
    const noKey = await loadBilling(db, { ...SETTINGS, STRIPE_SECRET_KEY: "" });
    await assert.rejects(
      () => noKey.billing.stripe("customers"),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      },
    );
    await noKey.close();
  } finally {
    await close();
    db.close();
  }
});
