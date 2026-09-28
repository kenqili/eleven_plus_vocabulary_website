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
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const PRICE = "price_monthly_123";
const CUSTOMER = "cus_123";
const USER = "user_1";

// One module runner for the whole file. Creating a server per test was slow and
// each one tried to bind the same HMR socket, which stalled the run. The env
// object handed to `cloudflare:workers` is mutated in place instead of replaced,
// because the stub exports that object once and billing reads it on every call.
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
        resolveId: (id) => (id === "cloudflare:workers" ? "\0workers-env" : null),
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
// A Vite server holds its file watcher and sockets open, so the test process
// would never exit on its own. Closing has to be awaited, which an "exit"
// listener cannot do, so it happens after the last test instead.
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

/** Points the app at one database and one set of settings. */
function setEnv(db, settings = SETTINGS) {
  workersEnv.DB = db;
  for (const key of Object.keys(workersEnv))
    if (key !== "DB") delete workersEnv[key];
  Object.assign(workersEnv, settings);
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
  db
    .prepare(
      "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
    )
    .bind(USER, "parent@example.test", "hash", 1_700_000_000, CUSTOMER)
    .run();
}

const subscription = (price = PRICE, status = "active") => ({
  id: "sub_1",
  customer: CUSTOMER,
  status,
  current_period_end: 1_800_000_000,
  items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] },
});

// The local D1 shim takes its values from bind(), not from run()/all(), and
// all() is async, so every read here awaits.
const rows = async (db, sql, ...args) =>
  (await db.prepare(sql).bind(...args).all()).results;

test("syncSubscription records access for a subscription on the right price", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({ "subscriptions/sub_1": subscription() });
  try {
    await billing.syncSubscription("sub_1");
    const [row] = await rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(row.user_id, USER);
    assert.equal(row.status, "active");
    assert.equal(row.price_id, PRICE);
    assert.equal(row.period_end, 1_800_000_000);
    // Access must be time-limited, or a lapsed subscription would read as live.
    assert.ok(row.checked_at > 0);
  } finally {
    stripe.restore();
    db.close();
  }
});

test("syncSubscription refuses access when the price is not the one we sell", async () => {
  // Somebody subscribing to a different product through the same Stripe
  // account must not unlock this site.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({ "subscriptions/sub_1": subscription("price_annual_999") });
  try {
    await billing.syncSubscription("sub_1");
    const [row] = await rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(row.status, "inactive", "a price we do not sell grants nothing");
    // The row is recorded with no price, so membership()'s price_id filter
    // cannot pick it up however its status reads later.
    assert.equal(row.price_id, "");
    assert.equal(row.period_end, 1_800_000_000);
  } finally {
    stripe.restore();
    db.close();
  }
});

test("a delayed webhook cannot restore access that has already been withdrawn", async () => {
  // Stripe delivers out of order and retries for days. Two events for one
  // subscription can arrive cancelled-then-active, and the second must not
  // reinstate a membership the first one ended.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({ "subscriptions/sub_1": subscription() });
  const realNow = Date.now;
  try {
    // A newer observation, made now, records a cancelled subscription. The
    // clock is read once so the stored value can be compared exactly.
    const observedAt = realNow();
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,status,period_end,price_id,checked_at) VALUES (?,?,?,?,?,?)",
      )
      .bind("sub_1", USER, "canceled", 1, PRICE, observedAt)
      .run();

    // Now replay the older still-active payload, as a delayed retry would.
    // The clock is moved back so the replay carries an older checked_at, and
    // the app's own upsert has to refuse it. Driving the real function is the
    // point: copying the SQL here would pass even if the app's guard were gone.
    Date.now = () => observedAt - 60_000;
    await billing.syncSubscription("sub_1");
    Date.now = realNow;

    const [row] = await rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(row.status, "canceled", "a delayed event must not restore access");
    assert.equal(row.checked_at, observedAt, "the newer observation is kept");

    // The same event arriving in order does apply, so the guard is not simply
    // refusing every write after the first.
    await billing.syncSubscription("sub_1");
    const [fresh] = await rows(db, "SELECT * FROM subscriptions WHERE id='sub_1'");
    assert.equal(fresh.status, "active", "a current event does apply");
  } finally {
    Date.now = realNow;
    stripe.restore();
    db.close();
  }
});

test("a Stripe customer we do not know grants nobody access", async () => {
  // The webhook is authenticated but not authorised to a user: a valid signature
  // only proves Stripe sent it. Linking is by customer id, so an unknown one has
  // to be a no-op rather than a guess.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({
    "subscriptions/sub_1": { ...subscription(), customer: "cus_someone_else" },
  });
  try {
    await billing.syncSubscription("sub_1");
    assert.equal((await rows(db, "SELECT * FROM subscriptions")).length, 0);
  } finally {
    stripe.restore();
    db.close();
  }
});

test("checkoutSession asks Stripe for a subscription on our price and returns to our origin", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
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
    const [row] = await rows(db, "SELECT * FROM checkout_requests WHERE user_id=?", USER);
    assert.equal(row.session_id, "cs_1");
  } finally {
    stripe.restore();
    db.close();
  }
});

test("an unfinished checkout is reused instead of starting a second one", async () => {
  // A parent who clicks Subscribe twice, or refreshes, must not end up with two
  // live subscriptions or a second charge.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
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
    db.close();
  }
});

test("the API key never reaches the browser and Stripe errors do not leak", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
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
    db.close();
  }
});

test("billing stays switched off until every Stripe setting is present", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  try {
    setEnv(db);
    const billing = await billingModule();
    assert.equal(billing.billingReady(), true);
    for (const missing of [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID",
      "STRIPE_WEBHOOK_SECRET",
      "APP_ORIGIN",
    ]) {
      // The same loaded module, so this is the app's own gate and not a second
      // copy of the settings object.
      setEnv(db, { ...SETTINGS, [missing]: "" });
      assert.equal(
        billing.billingReady(),
        false,
        `${missing} alone must not enable payments`,
      );
    }
    // With no key at all, the API refuses rather than calling Stripe with "".
    setEnv(db, { ...SETTINGS, STRIPE_SECRET_KEY: "" });
    await assert.rejects(
      () => billing.stripe("customers"),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      },
    );
  } finally {
    db.close();
  }
});
