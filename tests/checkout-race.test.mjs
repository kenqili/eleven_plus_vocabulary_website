// Two checkouts at once, which is the way a parent gets charged twice.
//
// A fixed term has no Stripe rule about one session per customer - there is no
// subscription - so nothing at Stripe stops two `checkout/sessions` calls for one
// customer from both succeeding. The only thing standing between a double-click and
// a double charge was this app, and it was this app that let it through.
//
// The bug it fixes: `checkout_requests` was written with `ON CONFLICT DO UPDATE`
// that replaced the token unconditionally whenever the row had no session. Two
// overlapping requests therefore both wrote a fresh token, each read back whichever
// token landed last, and derived two different Stripe idempotency keys from two
// different tokens. Stripe honours both keys. Two sessions, one intention, and a
// parent who pays twice.
//
// What is asserted here is the shape of the guarantee rather than the wording of
// any message: for one account, at most one live Stripe session at a time, and a
// second attempt is refused rather than served a second session.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const PRICE = "price_monthly_123";
const QUARTERLY = "price_quarterly_456";
const YEARLY = "price_yearly_789";
const CUSTOMER = "cus_123";
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
import { after } from "node:test";
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

const SETTINGS = {
  APP_ORIGIN: "https://minewords.test",
  STRIPE_SECRET_KEY: "sk_test_offline",
  STRIPE_PRICE_MONTHLY: PRICE,
  STRIPE_PRICE_QUARTERLY: QUARTERLY,
  STRIPE_PRICE_YEARLY: YEARLY,
  STRIPE_WEBHOOK_SECRET: "whsec_offline",
};

function seed(db) {
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  )
    .bind(USER, "parent@example.test", "hash", 1_700_000_000, CUSTOMER)
    .run();
}

function setEnv(db) {
  workersEnv.DB = db;
  for (const key of Object.keys(workersEnv))
    if (key !== "DB") delete workersEnv[key];
  Object.assign(workersEnv, SETTINGS);
}

/**
 * A Stripe stub that hands out a NEW session id every time one is created, and
 * records the idempotency key it was called with.
 *
 * The new-id behaviour matters: it is what makes a double charge *visible*. A stub
 * that returned the same id twice would hide the bug behind an accident, and the
 * test would pass for the wrong reason.
 */
function stubStripe() {
  const calls = [];
  const original = globalThis.fetch;
  let created = 0;
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "");
    const key = init?.headers?.["Idempotency-Key"];
    calls.push({ path, method: init?.method, key });
    if (path === "checkout/sessions" && init?.method === "POST") {
      const n = ++created;
      return new Response(
        JSON.stringify({
          id: `cs_${n}`,
          url: `https://checkout.stripe.test/cs_${n}`,
        }),
        { status: 200 },
      );
    }
    // Any session read: open, so it is reused rather than replaced.
    const id = path.split("/").pop();
    return new Response(
      JSON.stringify({
        id,
        status: "open",
        url: `https://checkout.stripe.test/${id}`,
      }),
      { status: 200 },
    );
  };
  return {
    calls,
    get created() {
      return created;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

const sessionsCreated = (stripe) =>
  stripe.calls.filter(
    (c) => c.path === "checkout/sessions" && c.method === "POST",
  ).length;

test("two checkouts at once produce one Stripe session, not two", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe();
  try {
    // The two a parent actually produces: a double-click that gets through, two
    // tabs, or one retry after the first request was slow. Fired together rather
    // than in sequence, because a sequential pair is not the bug - the second call
    // finds a session id by then and is correctly served the same session.
    const [first, second] = await Promise.allSettled([
      billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN, "monthly"),
      billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN, "monthly"),
    ]);

    assert.equal(
      sessionsCreated(stripe),
      1,
      "two requests for one account opened two Stripe sessions, which is two chances to be charged twice",
    );
    // One of them succeeded and the other was refused as in-progress. Which one is
    // not part of the contract, and asserting it would make the test flaky.
    const outcomes = [first, second];
    assert.equal(
      outcomes.filter((o) => o.status === "fulfilled").length,
      1,
      "both requests were served, or neither was",
    );
    const refused = outcomes.find((o) => o.status === "rejected");
    assert.equal(refused.reason.status, 409);
    assert.equal(
      refused.reason.code,
      "checkout_in_progress",
      "the refusal carries no stable code, so the interface cannot tell it from a failure",
    );
    // And the message has to be actionable: it says to wait, and says the parent
    // will not be charged twice. A bare "conflict" would be read as something
    // broken.
    assert.match(refused.reason.message, /wait a moment/i);
    assert.match(refused.reason.message, /not charge you twice/i);

    // The row names one session, so the next attempt reuses it rather than adding
    // another.
    const row = await db
      .prepare("SELECT session_id FROM checkout_requests WHERE user_id=?")
      .bind(USER)
      .first();
    assert.match(row.session_id, /^cs_1$/);
  } finally {
    stripe.restore();
    db.close();
  }
});

test("the refusal is a status the interface shows, not a red error", async () => {
  // Same reason `membership_applied` is a status: a parent who is told there is a
  // conflict in a red box presses the button again, which is the very thing that
  // causes the double charge.
  const account = readFileSync("components/minewords/account.tsx", "utf8");
  assert.match(
    account,
    /failure\.code === "checkout_in_progress"[\s\S]{0,400}setNotice/,
    "an in-progress checkout is shown in the error box, so the parent presses again",
  );
  assert.doesNotMatch(
    account,
    /checkout_in_progress[\s\S]{0,400}setError\(/,
    "the in-progress refusal is routed to setError",
  );
});

test("a lock that outlives its holder cannot lock a parent out", async () => {
  // The failure mode of any lock is being held by something that is never coming
  // back: a Worker evicted between writing the row and writing the session id.
  // There is no unlock call here to forget and no row to release, because the lock
  // is `created_at` and a timestamp stops being a lock by being old. A parent waits
  // seconds, not the half hour the old age guard cost them.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  assert.match(
    billing,
    /const CHECKOUT_LOCK_SECONDS = \d+/,
    "the lock window is not a named constant",
  );
  // Asserted as a bound rather than an exact number, because the number is a
  // judgement about Stripe latency and should be free to move. What must not be
  // free to move is "an hour".
  const window = Number(/CHECKOUT_LOCK_SECONDS = (\d+)/.exec(billing)[1]);
  assert.ok(
    window > 0 && window <= 300,
    `the lock window is ${window}s; a parent waiting that long has been locked out, not protected`,
  );
  // And the takeover clause is what releases it, so the assertion is that a stale
  // row can still be taken - a lock nothing can take over is a permanent block.
  assert.match(
    billing,
    /checkout_requests\.created_at < \?/,
    "a stale row cannot be taken over, so a lock is never released",
  );
});

test("two accounts are not locked against each other", async () => {
  // The lock is per account. A row keyed on `user_id` means a family cannot stop
  // another family buying, which is what a global lock would do - and this app has
  // no need for one, since the thing being protected is one customer's two
  // sessions, never two customers' one each.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  )
    // Its own Stripe customer, because `users.customer_id` is UNIQUE - two families
    // cannot share one customer id. That is also the realistic case: each account
    // gets a customer created for it on first purchase.
    .bind("user_2", "other@example.test", "hash", 1_700_000_000, "cus_456")
    .run();
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe();
  try {
    await Promise.allSettled([
      billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN, "monthly"),
      billing.checkoutSession(
        "user_2",
        "cus_456",
        SETTINGS.APP_ORIGIN,
        "monthly",
      ),
    ]);
    assert.equal(
      sessionsCreated(stripe),
      2,
      "one account's checkout blocked another's, which is not what the lock is for",
    );
  } finally {
    stripe.restore();
    db.close();
  }
});
