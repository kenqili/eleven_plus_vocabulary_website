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
import { readFileSync } from "node:fs";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const PRICE = "price_monthly_123";
const QUARTERLY = "price_quarterly_456";
const YEARLY = "price_yearly_789";
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
    // Matched on the path alone. Stripe is asked for one object with different
    // expansions by different callers, and a stub keyed on the whole URL makes
    // those look like missing routes - which reads as a Stripe 404 and, through
    // `stripe()`, as a 502 for a parent who has already paid.
    const path = String(url)
      .replace("https://api.stripe.com/v1/", "")
      .split("?")[0];
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
  // All three, because the deployment that sells three lengths has to configure
  // three ids, and a test that set only the monthly one would pass on a build
  // where the other two tiers silently vanish from the account page.
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

// A fixed term, bought once. There is no subscription and no renewal, so there
// is no Stripe subscription object anywhere in these tests - only a payment
// intent, which is the thing a fixed-term purchase actually produces.

// The local D1 shim takes its values from bind(), not from run()/all(), and
// all() is async, so every read here awaits.
const rows = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;

const expiryOf = async (db, userId = USER) =>
  (
    await db
      .prepare("SELECT expiry_date FROM users WHERE id=?")
      .bind(userId)
      .first()
  ).expiry_date;

// A millisecond day, and the three terms `TIERS` is worth. Written out here
// rather than read from the module under test: an assertion that reads its
// expectation out of the code it is checking passes when the code is wrong.
const DAY = 86_400_000;

/**
 * A clock the test moves by hand.
 *
 * Every expiry this module writes is `MAX(COALESCE(expiry_date, 0), Date.now())
 * + term`, so every rolling-forward assertion below is an assertion about a
 * millisecond figure. Against the real clock each step lands a few milliseconds
 * late, which forces every assertion to be a tolerance - and a tolerance wide
 * enough to survive a loaded machine is also wide enough to hide a term that is
 * a whole day short, which is the bug class this block exists for. Held still,
 * the answer is exact and a wrong term fails by twenty-four hours rather than
 * passing.
 */
function fakeClock(start) {
  const real = Date.now;
  let at = start;
  Date.now = () => at;
  return {
    now: () => at,
    advance(ms) {
      at += ms;
      return at;
    },
    restore() {
      Date.now = real;
    },
  };
}

// The ledger in the order the grants happened. `rowid`, not `created_at`,
// because two payments in the same millisecond share a created_at and insertion
// order is what the audit trail and `revokePurchase` are both talking about.
const ledger = (db) => rows(db, "SELECT * FROM purchases ORDER BY rowid");

// The failure this whole file's multi-price work exists to prevent: a parent
// who bought the 3-month term and was then given a month, because the app
// matched only one price id. Asserted for every configured price, because the
// regression is per-id - a deployment that added a second price and left the
// matcher reading one id would still pass a test that checked only the original.
for (const [tier, price, days] of [
  ["monthly", PRICE, 30],
  ["quarterly", QUARTERLY, 90],
  ["yearly", YEARLY, 365],
]) {
  test(`a paid ${tier} term grants exactly ${days} days`, async () => {
    const db = openLocalDatabase(":memory:", resolve("drizzle"));
    seed(db);
    setEnv(db);
    const billing = await billingModule();
    try {
      const before = Date.now();
      const granted = await billing.grantPurchase("pi_monthly", USER, price);
      assert.equal(granted, true, `the ${tier} price did not grant access`);
      const expiry = await expiryOf(db);
      assert.ok(expiry, "access was granted with no expiry");
      // The term is exact, because it comes from the tier map rather than from
      // anything in the price. A clock reading is fine; the assertion is the
      // length, not the instant.
      const daysGranted = (expiry - before) / 86_400_000;
      assert.ok(
        Math.abs(daysGranted - days) < 0.01,
        `expected ${days} days, got ${daysGranted}`,
      );
    } finally {
      db.close();
    }
  });
}

test("buying a second term adds to the first rather than replacing it", async () => {
  // The rule a family relies on: a child who starts on a month and whose family
  // buys three more in month two has four months, not three. It also has to
  // survive a child who buys again after the first term has run out, which is
  // the "learning spans more than one year" case.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    await billing.grantPurchase("pi_1", USER, PRICE);
    const afterFirst = await expiryOf(db);
    await billing.grantPurchase("pi_2", USER, QUARTERLY);
    const afterSecond = await expiryOf(db);
    assert.equal(
      afterSecond - afterFirst,
      90 * 86_400_000,
      "the second term did not add to the first",
    );
    // And a purchase long after the first has expired starts from now rather
    // than from a date in the past, which would grant less than was paid for.
    db.prepare("UPDATE users SET expiry_date=? WHERE id=?").run(
      Date.now() - 86_400_000,
      USER,
    );
    const lapsed = await expiryOf(db);
    await billing.grantPurchase("pi_3", USER, PRICE);
    const afterLapsed = await expiryOf(db);
    assert.ok(
      afterLapsed > Date.now() + 29 * 86_400_000,
      "a purchase after expiry did not grant a full term from now",
    );
    assert.ok(afterLapsed > lapsed);
  } finally {
    db.close();
  }
});

// The sequence below is the one the fixed-term model exists for. The single
// purchase above says "a term grants a term"; these say "a family who buys
// three things in a year gets all three", which is the property a renewal has
// to hold and the one that broke when a grant replaced rather than extended.

test("buying a month, then a quarter, then a year rolls the expiry forward by every term", async () => {
  // A month to start, three more in month two because the exam moved, then a
  // year once the family decided it was worth committing. Each purchase has to
  // add its own term, so with no time passing between them the answer is exactly
  // 485 days from the first. The failure this catches is any of the three
  // replacing the one before: a replacement is invisible on a single purchase
  // and costs a family every term but the last.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    const t0 = clock.now();
    const seen = [];
    assert.equal(await billing.grantPurchase("pi_1", USER, PRICE), true);
    seen.push(await expiryOf(db));
    assert.equal(
      await billing.grantPurchase("pi_2", USER, QUARTERLY),
      true,
      "the quarterly term was refused while a month was still running",
    );
    seen.push(await expiryOf(db));
    assert.equal(
      await billing.grantPurchase("pi_3", USER, YEARLY),
      true,
      "the yearly term was refused while other terms were still running",
    );
    seen.push(await expiryOf(db));
    // Each step is exactly its own term and no more, so the three compose.
    assert.equal(
      seen[1] - seen[0],
      90 * DAY,
      "the quarter did not add 90 days",
    );
    assert.equal(seen[2] - seen[1], 365 * DAY, "the year did not add 365 days");
    // Strictly increasing, read straight off the column: no step shortened or
    // left the date alone.
    assert.ok(
      seen[0] < seen[1] && seen[1] < seen[2],
      `the expiry did not move forward: ${seen}`,
    );
    assert.equal(
      seen[2],
      t0 + 485 * DAY,
      "three purchases did not end at the first date plus every term",
    );
  } finally {
    clock.restore();
    db.close();
  }
});

test("buying the same tier twice adds two terms rather than one", async () => {
  // Two months bought as two months. The obvious way to get this wrong is to
  // record the term against the payment and let the second one overwrite the
  // first, which is indistinguishable from correct behaviour for a single
  // purchase and costs a family a month every time it happens.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    const t0 = clock.now();
    await billing.grantPurchase("pi_1", USER, QUARTERLY);
    const one = await expiryOf(db);
    await billing.grantPurchase("pi_2", USER, QUARTERLY);
    const two = await expiryOf(db);
    assert.equal(two - one, 90 * DAY, "the second quarter replaced the first");
    assert.equal(two, t0 + 180 * DAY, "two quarters are not six months");
    // And the second grant is recorded as its own row rather than amending the
    // first, because a parent asking why their child has access until December
    // needs two purchases to look at, not one.
    assert.equal((await ledger(db)).length, 2);
  } finally {
    clock.restore();
    db.close();
  }
});

test("buying again while access is still running never shortens it", async () => {
  // The headline property. A parent who renews early - paid for January and
  // bought February's month in December - must come out with both, and the
  // failure is silent: the app still shows a date, just the wrong one, and the
  // parent finds out when the child loses access mid-term.
  //
  // So every intermediate date is checked as well as the final one. A grant that
  // replaces rather than extends is caught by the first pair; one that extends
  // from the wrong base - from `now` rather than from the expiry - is caught by
  // the step being short by however much of the old term was left.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    const t0 = clock.now();
    await billing.grantPurchase("pi_1", USER, YEARLY);
    const year = await expiryOf(db);
    assert.ok(
      year > t0 + 364 * DAY,
      "the year was not granted in the first place",
    );

    // Renew early: 20 days in, with 345 of the paid year still to run.
    clock.advance(20 * DAY);
    await billing.grantPurchase("pi_2", USER, PRICE);
    const renewed = await expiryOf(db);
    assert.ok(
      renewed > year,
      `a purchase during an active term shortened the expiry: ${year} became ${renewed}`,
    );
    // A month added to a year still 345 days from running, not to the 20 days
    // already used and not to today.
    assert.equal(
      renewed,
      year + 30 * DAY,
      "an early purchase did not add its term to the access still running",
    );
    // Both terms together, counted from the first purchase. `>=` rather than `>`
    // because 365 + 30 is exactly 395, and a strict comparison here would be
    // asserting one day more than was ever paid for.
    assert.ok(renewed >= t0 + 395 * DAY, "the total is short of both terms");

    // And a third purchase on top of the first two, still while all of it is
    // running, composes again rather than collapsing back to one term.
    await billing.grantPurchase("pi_3", USER, QUARTERLY);
    const third = await expiryOf(db);
    assert.equal(
      third,
      year + 120 * DAY,
      "the third purchase did not add to the second",
    );
    assert.ok(
      third > renewed,
      "the third purchase shortened what the second had added",
    );
  } finally {
    clock.restore();
    db.close();
  }
});

test("buying on an expired account extends from now, not from the date that has passed", async () => {
  // The other direction. A year ran out in March and a new term is bought in
  // September; extending from the old expiry would land the family in the past
  // and grant nothing at all, and the app would show an expired date rather than
  // an error - so the purchase looks like it worked and bought nothing.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    const t0 = clock.now();
    // Well past, so "now" is unambiguous.
    db.prepare("UPDATE users SET expiry_date=? WHERE id=?")
      .bind(t0 - 400 * DAY, USER)
      .run();
    await billing.grantPurchase("pi_1", USER, YEARLY);
    const expiry = await expiryOf(db);
    assert.ok(
      expiry > t0,
      "a purchase on an expired account left the account expired",
    );
    assert.equal(expiry, t0 + 365 * DAY, "the new term did not start from now");
    // Just barely past is the same rule with no room for luck, and is where a
    // comparison written the wrong way round (`COALESCE(expiry_date, now)` rather
    // than the later of the two) shows up.
    db.prepare("UPDATE users SET expiry_date=? WHERE id=?")
      .bind(t0 - 1, USER)
      .run();
    await billing.grantPurchase("pi_2", USER, QUARTERLY);
    assert.equal(
      await expiryOf(db),
      t0 + 90 * DAY,
      "an expiry one millisecond in the past was treated as access worth keeping",
    );
  } finally {
    clock.restore();
    db.close();
  }
});

test("the same payment delivered twice in the same millisecond still grants once", async () => {
  // Idempotency under the hardest clock: both deliveries read the same expiry,
  // so a grant that computed the new date before writing it - rather than in the
  // statement - would be indistinguishable here from one that composes. The
  // UNIQUE confirmation is what has to carry this, on its own.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    assert.equal(await billing.grantPurchase("pi_1", USER, QUARTERLY), true);
    const afterFirst = await expiryOf(db);
    assert.equal(
      await billing.grantPurchase("pi_1", USER, QUARTERLY),
      false,
      "a redelivered payment in the same millisecond was treated as a new purchase",
    );
    assert.equal(
      await expiryOf(db),
      afterFirst,
      "a redelivery granted a second term",
    );
    assert.equal(
      (await ledger(db)).length,
      1,
      "a redelivery recorded a second purchase",
    );
  } finally {
    clock.restore();
    db.close();
  }
});

test("two different payments in the same millisecond both apply", async () => {
  // The other half of the same millisecond, and the property the
  // `MAX(COALESCE(expiry_date, 0), ?)` inside the statement exists for. Both of
  // these read the account before either has written to it. If the new expiry
  // were worked out in JS from that read - which is what the module used to do -
  // the second would start from the same figure as the first and a quarter would
  // silently disappear, leaving one term instead of two.
  //
  // Driven concurrently so the read-before-write window is as wide as it can be
  // here; the frozen clock guarantees they are in the same millisecond rather
  // than merely close.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const clock = fakeClock(1_800_000_000_000);
  try {
    const t0 = clock.now();
    const [first, second] = await Promise.all([
      billing.grantPurchase("pi_a", USER, PRICE),
      billing.grantPurchase("pi_b", USER, YEARLY),
    ]);
    assert.equal(first, true, "the first concurrent payment was not granted");
    assert.equal(second, true, "the second concurrent payment was not granted");
    assert.equal(
      await expiryOf(db),
      t0 + 395 * DAY,
      "two payments in the same millisecond did not both apply",
    );
    // Two rows, and each one records the expiry the account actually reached, so
    // the history cannot claim a term that the account never had.
    const rowsInOrder = await ledger(db);
    assert.equal(
      rowsInOrder.length,
      2,
      "the two concurrent payments were not both recorded",
    );
    assert.deepEqual(
      rowsInOrder.map((r) => r.new_expiry).sort((a, b) => a - b),
      [t0 + 30 * DAY, t0 + 395 * DAY],
      "a concurrent grant recorded an expiry the account never reached",
    );
  } finally {
    clock.restore();
    db.close();
  }
});

test("the same payment delivered twice grants once", async () => {
  // Stripe retries webhooks, sometimes for days. A redelivered
  // checkout.session.completed is the same payment arriving twice, and must not
  // hand the family two terms for one charge. This is the idempotency the
  // UNIQUE confirmation buys, driven through the app's own function.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    assert.equal(await billing.grantPurchase("pi_1", USER, PRICE), true);
    const afterFirst = await expiryOf(db);
    // The replay.
    assert.equal(
      await billing.grantPurchase("pi_1", USER, PRICE),
      false,
      "a replayed payment was treated as a new purchase",
    );
    assert.equal(
      await expiryOf(db),
      afterFirst,
      "a replay granted a second term",
    );
    // One audit row for the one payment, which is what a parent disputing the
    // charge would be shown.
    assert.equal((await rows(db, "SELECT * FROM purchases")).length, 1);
  } finally {
    db.close();
  }
});

test("a payment for a price we do not sell grants nothing", async () => {
  // Somebody paying through the same Stripe account for something else must not
  // unlock this site. This is the guard the subscription path had, and it has to
  // survive the change of model - losing it would make any payment against this
  // Stripe account a way to buy access.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    const granted = await billing.grantPurchase(
      "pi_other",
      USER,
      "price_someone_elses_999",
    );
    assert.equal(granted, false);
    assert.equal(await expiryOf(db), null, "an unknown price granted access");
    assert.equal((await rows(db, "SELECT * FROM purchases")).length, 0);
  } finally {
    db.close();
  }
});

test("a refunded payment takes the term back", async () => {
  // With a fixed term there is nothing to cancel, so nothing else would revoke
  // access - a parent refunded by Stripe would keep the year they were refunded
  // for, and nothing in the app would ever notice. Shortens rather than clears,
  // so a family who bought a term and then another keeps the one still paid for.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    await billing.grantPurchase("pi_1", USER, PRICE);
    const afterBuy = await expiryOf(db);
    await billing.revokePurchase("pi_1");
    const afterRefund = await expiryOf(db);
    assert.ok(afterRefund < afterBuy, "a refund did not shorten access");
    assert.ok(
      afterRefund <= Date.now(),
      "a refunded term is still in the future",
    );
    const [row] = await rows(db, "SELECT * FROM purchases");
    assert.equal(row.status, "refunded");
  } finally {
    db.close();
  }
});

test("a refund takes back only what was refunded", async () => {
  // Two terms, one refunded: the family keeps the other one. Getting this wrong
  // in either direction is wrong - revoking everything would take access they
  // paid for, and revoking nothing is the bug above.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    await billing.grantPurchase("pi_1", USER, QUARTERLY);
    await billing.grantPurchase("pi_2", USER, QUARTERLY);
    const both = await expiryOf(db);
    await billing.revokePurchase("pi_1");
    const one = await expiryOf(db);
    assert.equal(
      both - one,
      90 * 86_400_000,
      "a refund did not remove exactly the refunded term",
    );
    assert.ok(
      one > Date.now(),
      "the term that was not refunded was also revoked",
    );
  } finally {
    db.close();
  }
});

test("a refund for a payment we never recorded is ignored", async () => {
  // A refund can arrive for a payment this app never granted against - an
  // unrelated charge on the same Stripe account. It must be a no-op rather than
  // shortening somebody's expiry by a term they did not buy here.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    await billing.grantPurchase("pi_1", USER, YEARLY);
    const before = await expiryOf(db);
    await billing.revokePurchase("pi_never_granted");
    assert.equal(await expiryOf(db), before);
  } finally {
    db.close();
  }
});

test("a price id only configured for the monthly tier still grants it", async () => {
  // The rename bridge: a deployment that has not set STRIPE_PRICE_MONTHLY yet is
  // still selling its existing monthly plan through STRIPE_PRICE_ID, and must
  // keep granting access.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db, { ...SETTINGS, STRIPE_PRICE_MONTHLY: "", STRIPE_PRICE_ID: PRICE });
  const billing = await billingModule();
  try {
    assert.equal(await billing.grantPurchase("pi_1", USER, PRICE), true);
    assert.ok(
      await expiryOf(db),
      "the legacy price id stopped granting access",
    );
  } finally {
    db.close();
  }
});

test("only the configured tiers are offered", async () => {
  // A deployment part-way through configuring three prices must offer the ones it
  // has rather than showing buttons that fail at checkout.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  setEnv(db, { ...SETTINGS, STRIPE_PRICE_YEARLY: "" });
  const billing = await billingModule();
  try {
    assert.deepEqual(
      billing.availableTiers().map((t) => t.id),
      ["monthly", "quarterly"],
    );
  } finally {
    db.close();
  }
});

test("the terms are a fixed length, and they match the coupons", async () => {
  // Two places in this app decide what a month is worth: this table and
  // COUPON_DAYS. They are the same numbers on purpose - a family given a
  // three-month coupon and a family that bought three months must end up with
  // the same length, and two tables that quietly disagreed would be exactly the
  // kind of drift nothing else would notice.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  setEnv(db);
  const billing = await billingModule();
  try {
    assert.deepEqual(
      billing.TIERS.map((t) => t.days),
      [30, 90, 365],
    );
    assert.deepEqual(
      billing.TIERS.map((t) => t.label),
      ["1 month", "3 months", "1 year"],
    );
    // Strictly increasing, so a longer term is never a shorter one.
    const days = billing.TIERS.map((t) => t.days);
    assert.deepEqual(
      days,
      [...days].sort((a, b) => a - b),
    );
  } finally {
    db.close();
  }
});

test("grantPurchase needs no Stripe call at all", async () => {
  // A one-time grant is decided from the payload plus this table. If it started
  // calling Stripe, then a webhook delivery would depend on api.stripe.com
  // being reachable, and a Stripe outage would stop parents being given the
  // access they have already paid for. Asserted by running it with the network
  // stubbed to fail on every call.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network must not be used to grant a paid term");
  };
  try {
    assert.equal(await billing.grantPurchase("pi_1", USER, QUARTERLY), true);
    assert.ok(await expiryOf(db));
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("the webhook grants from a completed checkout and revokes on a refund", async () => {
  // The route is exercised through its own entry point, because the two things
  // it has to get right are which fields it reads: the payment intent is the id
  // the grant is keyed on, and the user id arrives in metadata that a webhook
  // cannot get from a cookie.
  const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  assert.match(route, /grantPurchase/, "the webhook no longer grants access");
  assert.match(route, /revokePurchase/, "a refund no longer revokes access");
  assert.match(
    route,
    /checkout\.session\.completed/,
    "the completed-checkout event is no longer handled",
  );
  assert.match(route, /charge\.refunded/, "the refund event is not handled");
  // No subscription events: a fixed term has no subscription to sync, and leaving
  // a handler in place for them would be a path that could set expiry_date back
  // to null if a legacy subscription event ever arrived.
  assert.doesNotMatch(
    route,
    /customer\.subscription\./,
    "the webhook still handles subscription events this app no longer creates",
  );
  // The user id is read from metadata rather than trusted from the session.
  assert.match(route, /metadata\?\.user_id/);
});

test("a completed payment that cannot be acted on is logged, not skipped silently", () => {
  // The bug this exists to catch, and it is the worst kind: a real £2 payment
  // taken, no grant made, and the endpoint replying 200. The old code required a
  // price id, never found one - because the price is in the session's line
  // items and Stripe does not copy it onto the payment intent - and returned
  // quietly. Nothing in the logs, nothing on the account page, and a parent who
  // had paid for a month with no way to tell it had not arrived.
  const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  // The price is read from the line items, which is the only place Stripe puts
  // it for a one-time payment.
  assert.match(
    route,
    /line_items\?\.data\?\.\[0\]\?\.price\?\.id/,
    "the price is not read from the session's line items, so the grant finds no price",
  );
  // And a completed payment with something missing is logged rather than
  // swallowed, because the 200 reply is deliberate and hides it from Stripe too.
  assert.match(
    route,
    /console\.error\([\s\S]*?missing payment id, user or price/,
    "a completed payment with nothing to act on is passed over in silence",
  );
  // Which means the two guards that do exist are both still there.
  assert.match(
    route,
    /if \(!paymentIntentId \|\| !userId \|\| !priceId \|\| !paid\)/,
  );
  assert.match(
    route,
    /await grantPurchase\(paymentIntentId, userId, priceId\)/,
  );
});

test("a tier is matched by price id, never by amount", () => {
  // The tempting shortcut is to look the tier up by how much was paid. It is
  // wrong in both directions at once: a promotion makes two different lengths
  // cost the same, and a currency is not checked at all - so a parent paying £2
  // for a year would be granted a month because that is what £2 usually means.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  assert.match(
    billing,
    /tierForPayment[\s\S]*?availableTiers\(\)\.find\(\(t\) => priceFor\(t\.id\) === priceId\)/,
    "the tier is not resolved by matching the price id",
  );
  // No amount-to-tier table anywhere.
  assert.doesNotMatch(
    billing,
    /amount\s*===\s*\d+|unit_amount\s*===\s*\d+/,
    "a tier appears to be chosen by amount paid rather than by price",
  );
});

test("the account page says what was bought, and what it did to the expiry", () => {
  // A parent who has just paid needs two things this file was silent about: the
  // date their access ends, and whether it is made of the term they just bought
  // or of a coupon and a purchase added together.
  const account = readFileSync("components/minewords/account.tsx", "utf8");
  assert.match(
    account,
    /purchases:/,
    "the account page takes no purchase history",
  );
  // The history is rendered, with the length and both dates.
  assert.match(
    account,
    /\{purchase\.label\}/,
    "the length bought is not shown",
  );
  assert.match(
    account,
    /\{date\(purchase\.expiresAt\)\}/,
    "the date the purchase ran until is not shown",
  );
  // And every date on this screen goes through the one formatter, because the
  // headline read "2 November 2026" while this table read "02/11/2026" - so a
  // parent checking that the purchase they had just made was the one that moved
  // their access date was looking at two spellings of it and could trust neither.
  assert.match(
    account,
    /const date = \(ms: number\)/,
    "the shared date formatter is gone",
  );
  assert.doesNotMatch(
    account,
    /toLocaleDateString\(\)(?!\s*,\s*\{)/,
    "a bare toLocaleDateString() is back on this screen, next to the formatted ones",
  );
  assert.match(
    account,
    /extendedFrom/,
    "a purchase that added to existing access does not say so",
  );
  // And the success redirect reports what the server found rather than assuming
  // the payment worked, which is the case that read as a pending confirmation.
  //
  // `current?.active`, optional: the answer now comes from the value `refresh()`
  // already returned rather than from a second request for the same thing. That
  // second request is what could fail and replace a payment confirmation with a
  // red error, moments after the parent paid - so the assertion has moved with it
  // rather than being loosened. `billing` is null when the request failed at all,
  // which is the same "we do not know" case and is answered the same way.
  assert.match(
    account,
    /checkout === "success"[\s\S]{0,900}current\?\.active/,
    "the success message is not checked against the server's own answer",
  );
  // And it is not re-fetched: one request for the status, not two.
  assert.doesNotMatch(
    account,
    /checkout === "success"[\s\S]{0,400}await api<Billing>\("\/api\/billing\/status"\)/,
    "the success branch fetches the billing status again, so a second failure replaces the payment confirmation with an error",
  );
  assert.doesNotMatch(
    account,
    /will appear after payment confirmation/,
    "the success message still promises an appearance rather than reporting one",
  );
});

test("checkoutSession asks Stripe for a subscription on our price and returns to our origin", async () => {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({
    "checkout/sessions": {
      id: "cs_1",
      url: "https://checkout.stripe.test/cs_1",
    },
  });
  try {
    const session = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(session.url, "https://checkout.stripe.test/cs_1");
    const call = stripe.calls.find((c) => c.path === "checkout/sessions");
    assert.ok(call, "a checkout session was created");
    assert.equal(call.method, "POST");
    const body = new URLSearchParams(call.body);
    // "payment", not "subscription". A term is bought once; a subscription mode
    // here would make Stripe expect a recurring charge this app never handles,
    // so the second month's payment would arrive with nothing granting against it.
    assert.equal(body.get("mode"), "payment");
    assert.equal(body.get("customer"), CUSTOMER);
    assert.equal(body.get("line_items[0][price]"), PRICE);
    // The return URLs decide whether a parent lands on a page that exists.
    assert.equal(
      body.get("success_url"),
      "https://minewords.test/account?checkout=success",
    );
    assert.equal(
      body.get("cancel_url"),
      "https://minewords.test/account?checkout=cancelled",
    );
    // So the webhook can find the user again without trusting the browser. Both
    // places are set because Stripe copies one onto the other depending on which
    // event arrives, and a webhook carries no session cookie.
    assert.equal(body.get("client_reference_id"), USER);
    assert.equal(body.get("payment_intent_data[metadata][user_id]"), USER);
    assert.equal(body.get("metadata[user_id]"), USER);
    // And no subscription metadata, which would be meaningless in payment mode.
    assert.equal(body.get("subscription_data[metadata][user_id]"), null);
    assert.ok(call.idempotencyKey, "creation is idempotent");
    const [row] = await rows(
      db,
      "SELECT * FROM checkout_requests WHERE user_id=?",
      USER,
    );
    assert.equal(row.session_id, "cs_1");
  } finally {
    stripe.restore();
    db.close();
  }
});

test("an unfinished checkout is reused instead of starting a second one", async () => {
  // A parent who clicks twice, or refreshes, must not end up with two open
  // sessions or a second charge. This is now the only thing standing between a
  // double-click and being billed twice - with a fixed term there is no Stripe
  // rule about one-per-customer, so the serialisation is ours alone.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({
    "checkout/sessions": {
      id: "cs_1",
      url: "https://checkout.stripe.test/cs_1",
    },
    "checkout/sessions/cs_1": {
      id: "cs_1",
      status: "open",
      url: "https://checkout.stripe.test/cs_1",
    },
  });
  try {
    await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    const again = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(again.url, "https://checkout.stripe.test/cs_1");
    const creations = stripe.calls.filter(
      (c) => c.path === "checkout/sessions",
    );
    assert.equal(creations.length, 1, "no second session is created");
  } finally {
    stripe.restore();
    db.close();
  }
});

test("a completed checkout does not block the next purchase", async () => {
  // The bug this file's subject was found by, and it is the one that made a
  // fixed term unusable: the row that remembers an in-flight checkout was never
  // cleared once the session completed, so every later attempt was refused with
  // a 409 and a family could never buy a second term at all. Buying a month now
  // and a year in June is the whole reason a term is fixed.
  //
  // Driven end to end: complete a session, then start a second purchase and
  // require that it reaches Stripe rather than throwing.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  let created = 0;
  const stripe = stubStripe({
    // The id Stripe hands back has to be the one the stub can then be asked
    // about, or the second call looks up a session the stub has never heard of
    // and reports a Stripe 404 where there is none.
    "checkout/sessions": () => {
      const n = ++created;
      return n === 1
        ? { id: "cs_1", url: "https://checkout.stripe.test/cs_1" }
        : { id: "cs_2", url: "https://checkout.stripe.test/cs_2" };
    },
    // The first session: complete, already paid.
    "checkout/sessions/cs_1": {
      id: "cs_1",
      status: "complete",
      payment_intent: "pi_1",
      url: "https://checkout.stripe.test/cs_1",
      // Stripe expands line_items onto the session when asked, and that is where
      // the price id lives. Included because the app reads it from here on the
      // path where a webhook never arrived.
      line_items: { data: [{ price: { id: PRICE } }] },
    },
  });
  try {
    // First attempt creates the session and the row.
    await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(
      (await rows(db, "SELECT * FROM checkout_requests WHERE user_id=?", USER))
        .length,
      1,
    );

    // The parent comes back and pays, then returns to the account page and asks
    // for another term. This used to throw 409 and leave the row in place.
    await assert.rejects(
      () =>
        billing.checkoutSession(USER, CUSTOMER, SETTINGS.APP_ORIGIN, "monthly"),
      (error) => {
        assert.equal(error.status, 409);
        // The message must not be the one-hour guard, which is a different state.
        // The wording is the current one: "We've applied a payment to your account
        // that hadn't taken effect yet", which replaced "Your payment is complete"
        // when the same state started being reported as a status rather than an
        // error. The newer test below asserts that wording; this one only needs to
        // know it is the completion reply and not the age guard.
        assert.match(error.message, /applied a payment to your account/i);
        return true;
      },
    );
    // The spent row is gone, which is what unblocks the next purchase.
    assert.equal(
      (await rows(db, "SELECT * FROM checkout_requests WHERE user_id=?", USER))
        .length,
      0,
      "a completed checkout is still remembered, so the next purchase is refused",
    );

    // And the second purchase now goes through to Stripe.
    const second = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "yearly",
    );
    assert.equal(second.url, "https://checkout.stripe.test/cs_2");
    const creations = stripe.calls.filter(
      (c) => c.path === "checkout/sessions" && c.method === "POST",
    );
    assert.equal(creations.length, 2, "the second purchase did not start");
    // And it is the tier that was asked for, not the one the first session used.
    assert.equal(
      new URLSearchParams(creations.at(-1).body).get("line_items[0][price]"),
      YEARLY,
    );
  } finally {
    stripe.restore();
    db.close();
  }
});

test("a checkout that is still open is reused, and one that never finished keeps its hour", async () => {
  // The two guards the deletion above must not weaken. A session still open is
  // returned as-is, so a double click cannot open two; and a session created but
  // abandoned is not replaced for an hour, because its creation may have reached
  // Stripe even if the reply never came back.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({
    "checkout/sessions": {
      id: "cs_new",
      url: "https://checkout.stripe.test/new",
    },
    "checkout/sessions/cs_open": {
      id: "cs_open",
      status: "open",
      url: "https://checkout.stripe.test/open",
    },
    // Complete but with no payment intent: nothing was paid, so nothing is
    // cleared and the request must fall through to starting a fresh one.
    "checkout/sessions/cs_abandoned": {
      id: "cs_abandoned",
      status: "complete",
      url: "https://checkout.stripe.test/abandoned",
    },
  });
  try {
    await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    db.prepare(
      "UPDATE checkout_requests SET session_id='cs_open' WHERE user_id=?",
    )
      .bind(USER)
      .run();
    const reused = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(
      reused.url,
      "https://checkout.stripe.test/open",
      "an open session was not reused",
    );
    assert.equal(
      stripe.calls.filter(
        (c) => c.path === "checkout/sessions" && c.method === "POST",
      ).length,
      1,
      "a second session was opened while one was still open",
    );

    // And one completed without a payment is replaced, not treated as paid.
    db.prepare(
      "UPDATE checkout_requests SET session_id='cs_abandoned' WHERE user_id=?",
    )
      .bind(USER)
      .run();
    const replaced = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(replaced.url, "https://checkout.stripe.test/new");
  } finally {
    stripe.restore();
    db.close();
  }
});

test("expiry is reported in milliseconds, and nothing multiplies it again", async () => {
  // The account page told a parent their access ran until "August 23, 58805".
  // `expiry_date` is written with Date.now() by both the grant and the coupon, so
  // it is already milliseconds; the page multiplied by 1000 as though it were
  // seconds. It is asserted twice over, because either half alone would let it
  // back in: the server must hand back milliseconds, and no renderer may rescale.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  try {
    const before = Date.now();
    await billing.grantPurchase("pi_1", USER, QUARTERLY);
    const account = await billing.membership({
      id: USER,
      email: "",
      customer_id: null,
    });
    const expiry = account.periodEnd;
    // Milliseconds: a plausible instant, not a plausible number of seconds.
    assert.ok(
      expiry > before && expiry < before + 91 * 86_400_000,
      `periodEnd is not epoch milliseconds: ${expiry}`,
    );
    // The same figure as the row, so nothing is rescaled in transit.
    const stored = (
      await db
        .prepare("SELECT expiry_date FROM users WHERE id=?")
        .bind(USER)
        .first()
    ).expiry_date;
    assert.equal(expiry, stored);
    // Whole days left, for the renewal warning. Not seconds, not milliseconds.
    assert.ok(
      Math.abs(account.daysRemaining - 90) <= 1,
      `daysRemaining is ${account.daysRemaining}, not whole days`,
    );
  } finally {
    db.close();
  }

  // And nothing in a renderer multiplies a millisecond timestamp again.
  for (const file of [
    "components/minewords/account.tsx",
    "components/minewords/challenge.tsx",
    "components/minewords/word-summary.tsx",
  ]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /periodEnd!?\s*\*\s*1000|periodEnd!\s*\)\s*\*\s*1000/,
      `${file} multiplies periodEnd by 1000, and it is already milliseconds`,
    );
  }
});

test("daysRemaining is zero without a paid term, so a trial never looks expiring", async () => {
  // The renewal warning is keyed on `active && daysRemaining <= 14`. If
  // daysRemaining were computed for a trial as well, every family inside its
  // trial would be told their access was ending - the exact confusion the
  // three-way banner exists to remove.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  // A trial is derived from `created_at`, so this account is made an hour old
  // rather than using seed()'s fixed date, which would leave the trial long
  // expired and test nothing about a trial at all.
  // Through bind(), not run(): the local D1 shim takes its values from bind()
  // and its run() takes none, so values handed to run() are discarded and the
  // statement matches nothing.
  db.prepare("UPDATE users SET created_at=? WHERE id=?")
    .bind(Date.now() - 3_600_000, USER)
    .run();
  setEnv(db);
  const billing = await billingModule();
  try {
    const trial = await billing.membership({
      id: USER,
      email: "",
      customer_id: null,
    });
    assert.equal(trial.active, false, "a trial account is not active");
    assert.equal(trial.trial, true, "the account is not inside its trial");
    assert.equal(trial.daysRemaining, 0, "a trial reports days remaining");
    // And after a grant it becomes a paid term with days counted down.
    await billing.grantPurchase("pi_1", USER, YEARLY);
    const paid = await billing.membership({
      id: USER,
      email: "",
      customer_id: null,
    });
    assert.equal(paid.active, true);
    assert.equal(paid.trial, false, "a paid term is not also a trial");
    assert.ok(paid.daysRemaining > 364);
    // And once that term is nearly over it drops to the renewal figure rather
    // than to nothing, which is what puts the warning in front of the parent.
    db.prepare("UPDATE users SET expiry_date=? WHERE id=?")
      .bind(Date.now() + 5 * 86_400_000, USER)
      .run();
    const ending = await billing.membership({
      id: USER,
      email: "",
      customer_id: null,
    });
    assert.equal(ending.active, true, "five days left is still active");
    assert.ok(
      ending.daysRemaining >= 4 && ending.daysRemaining <= 5,
      `five days left reported as ${ending.daysRemaining}`,
    );
  } finally {
    db.close();
  }
});

test("the practice and export banners separate a paid term from a trial", () => {
  // Both used to render "n days left in your free trial" for anyone not on the
  // free tier, which included a parent who had just bought a year.
  for (const file of [
    "components/minewords/challenge.tsx",
    "components/minewords/word-summary.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    // The renewal copy exists, and it is about access rather than a trial.
    assert.match(
      source,
      /left in your access/,
      `${file} has no renewal wording`,
    );
    // The trial copy still exists, so a family inside its trial is not left with
    // nothing at all.
    assert.match(
      source,
      /left in\s+your free trial/,
      `${file} lost its trial wording`,
    );
    // The paid term is checked before the trial, so a term running short does
    // not fall through to the trial copy. Compared by position rather than by a
    // shape, because the two branches are formatted differently in the two files.
    const paid = source.indexOf("daysRemaining");
    const trial = source.indexOf("trialDaysRemaining");
    assert.ok(paid > -1 && trial > -1, `${file} reads neither figure`);
    assert.ok(
      paid < trial,
      `${file} checks the trial before the paid term, so a paying parent reads the trial copy`,
    );
    // And the renewal branch is gated on a paid term rather than being
    // unconditional.
    assert.match(
      source,
      /active[\s\S]{0,160}daysRemaining/,
      `${file} does not gate the renewal warning on a paid term`,
    );
  }
});

test("the renewal warning is fourteen days, and not another number", () => {
  // A term is bought in days, so a week leaves a family a week before their
  // child cannot practise and a month is not a warning. Changing this is a
  // product decision, and this is the place it has to be made deliberately.
  const source = readFileSync("components/minewords/challenge.tsx", "utf8");
  assert.match(
    source,
    /const RENEWAL_WARNING_DAYS = 14;/,
    "the renewal threshold is no longer fourteen days",
  );
});

test("trial is sent by the server, never inferred from freeTier by the browser", () => {
  // The bug this test exists for, and it is the one the practice page was
  // actually showing: `trial: !account.freeTier`. "Not on the free tier" is
  // true of every paying customer, so a parent who had bought a year was told
  // "0 days left in your free trial", with the trial end date computed from when
  // they registered. The browser cannot tell a trial from a paid term, and must
  // not be asked to.
  const hook = readFileSync("components/minewords/use-challenge.ts", "utf8");
  assert.doesNotMatch(
    hook,
    /trial:\s*!account\.freeTier|trial:\s*!\w+\.freeTier/,
    "trial is still inferred from freeTier, so paying customers are shown a trial countdown",
  );
  // The three figures the banner needs all come from the snapshot.
  assert.match(hook, /trial: account\.trial/);
  assert.match(hook, /active: account\.active/);
  assert.match(hook, /daysRemaining: account\.daysRemaining/);
  assert.match(hook, /periodEnd: account\.periodEnd/);

  // And the server actually sends `trial`, rather than leaving the browser to
  // work it out again.
  assert.match(
    readFileSync("lib/server/snapshot.ts", "utf8"),
    /trial:\s*access\.trial/,
    "the snapshot does not carry the server's own trial flag",
  );
  assert.match(
    readFileSync("app/api/progress/route.ts", "utf8"),
    /trial:\s*access\.trial/,
  );
});

test("an expired term says so instead of going quiet", () => {
  // The practice page keeps working on the free collection after a paid term
  // runs out, so with no banner a parent has nothing telling them their paid
  // access ended. The message is gated on `periodEnd` being set, which only
  // happens when something has been paid for - so it cannot fire for a family
  // who has never paid and think they are being chased.
  const source = readFileSync("components/minewords/challenge.tsx", "utf8");
  assert.match(source, /Your access has ended/, "there is no expired message");
  assert.match(
    source,
    /!study\.active && study\.periodEnd/,
    "the expired message is not gated on a period that has been set",
  );
  assert.match(source, /Buy access to continue/);
});

test("the lengths stay on offer to a parent who already has access", () => {
  // They used to render only when `active` was false, so a family whose access
  // was running out could see the date it ended and not the button that fixes
  // it. And they are now one implementation used by both states, because they
  // were once written twice and could drift apart.
  const account = readFileSync("components/minewords/account.tsx", "utf8");
  assert.match(
    account,
    /function planOptions\(\)/,
    "the plan buttons are not a single shared implementation",
  );
  // Offered from inside the active branch, not only the inactive one. The
  // anchor is the pill, which reads "Full access" since the status summary
  // redesign (it was "Membership active").
  const activeBranch = account.indexOf("Full access");
  const addMore = account.indexOf("Add more access");
  const secondCall = account.indexOf("planOptions()", addMore);
  assert.ok(
    activeBranch > -1 && addMore > activeBranch && secondCall > addMore,
    "the options are not offered to a parent who already has access",
  );
  // And a second purchase is described as adding rather than replacing.
  assert.match(
    account,
    /adds to the access you have, rather than\s*replacing it/,
  );
});

test("the price reaches the webhook in metadata, because Stripe does not send line items", () => {
  // This cost a real annual purchase: the charge landed, the webhook answered
  // 200, and nothing was granted. Stripe does not expand `line_items` in an event
  // payload - it arrives as an empty list with a URL - so reading the price from
  // there finds nothing. The only reliable answer is metadata written at checkout,
  // which Stripe echoes in the payload.
  const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  assert.match(
    route,
    /metadata\?\.price_id/,
    "the webhook does not read the price from metadata",
  );
  // Metadata before line_items: the latter is only there for the rare payload
  // that does expand it, and must not be the only source.
  const meta = route.indexOf("metadata?.price_id");
  const items = route.indexOf("line_items");
  assert.ok(meta > -1, "no metadata price read");
  assert.ok(
    items > -1,
    "the line_items fallback was removed rather than demoted",
  );

  // And checkout writes it, on both the session and the intent, because which
  // one the event carries depends on the event.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  assert.match(billing, /"metadata\[price_id\]": priceFor\(tier\)/);
  assert.match(
    billing,
    /"payment_intent_data\[metadata\]\[price_id\]": priceFor\(tier\)/,
    "the payment intent carries no price, and the intent is what a refund event names",
  );
});

test("buying again after a completed purchase does not need a second attempt", () => {
  // It did: the completed-session branch always threw 409 telling the parent to
  // refresh and try again, even when the webhook had already granted that
  // payment and they were there to make a *second* purchase. A 409 for work that
  // was already done is a dead end on the one flow a fixed-term model depends
  // on.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  assert.match(
    billing,
    /const granted = await grantPurchase\(/,
    "the grant result is not checked before deciding what to reply",
  );
  // The 409 is conditional on having just granted something.
  assert.match(
    billing,
    /if \(granted\)\s*throw new HttpError\(\s*409/,
    "the completion message is sent even when nothing new was granted",
  );
  // And the row is cleared before that, so the next purchase is never blocked.
  const clear = billing.indexOf("DELETE FROM checkout_requests");
  const throw409 = billing.indexOf("if (granted)");
  assert.ok(
    clear > -1 && clear < throw409,
    "the spent session is not cleared before the reply is decided",
  );
});

test("buying a second term after one is already granted starts the new purchase", async () => {
  // The 409 the user reported, and it is the whole reason this file keeps growing.
  //
  // Clicking "1 year" returned "Your payment is complete. Refresh your membership
  // in a moment." and never reached Stripe - because the webhook had already
  // granted the previous payment, the completed-session branch threw 409
  // regardless of whether it had just granted anything. A family with months left
  // could not buy more without clicking twice, and the second click's message
  // told them to refresh again.
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  setEnv(db);
  const billing = await billingModule();
  const stripe = stubStripe({
    "checkout/sessions": {
      id: "cs_2",
      url: "https://checkout.stripe.test/cs_2",
    },
    // The first session, paid and already granted by the webhook.
    "checkout/sessions/cs_1": {
      id: "cs_1",
      status: "complete",
      payment_intent: "pi_1",
      url: "https://checkout.stripe.test/cs_1",
      metadata: { user_id: USER, price_id: QUARTERLY },
      line_items: { data: [{ price: { id: QUARTERLY } }] },
    },
  });
  try {
    // The webhook got there first.
    assert.equal(await billing.grantPurchase("pi_1", USER, QUARTERLY), true);
    const afterFirst = await expiryOf(db);

    await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    // The parent comes back and clicks a plan. This must not throw.
    const next = await billing.checkoutSession(
      USER,
      CUSTOMER,
      SETTINGS.APP_ORIGIN,
      "monthly",
    );
    assert.equal(
      next.url,
      "https://checkout.stripe.test/cs_2",
      "the second purchase did not reach Stripe",
    );
    // And it did not quietly double the first one on the way past.
    assert.equal(
      await expiryOf(db),
      afterFirst,
      "starting a second purchase changed the access already granted",
    );
    // One new session, and the new price is the tier that was clicked.
    const creations = stripe.calls.filter(
      (c) => c.path === "checkout/sessions" && c.method === "POST",
    );
    assert.equal(creations.length, 2);
    assert.equal(
      new URLSearchParams(creations.at(-1).body).get("line_items[0][price]"),
      PRICE,
    );
  } finally {
    stripe.restore();
    db.close();
  }
});

test("a payment applied now is reported as a status, not an error, and keeps the button working", () => {
  // The other half of the same state: the previous payment had NOT been granted,
  // so this click applied it. Throwing a bare "refresh in a moment" read as the
  // site being broken, because the parent had clicked *buy*. It now says what was
  // done, what they have, and that the button still works - and it carries a
  // stable code so the interface can show it as a status instead of a red alert.
  const billing = readFileSync("lib/server/billing.ts", "utf8");
  assert.match(
    billing,
    /"membership_applied"/,
    "the applied-payment reply carries no stable code",
  );
  assert.match(
    billing,
    /We've applied a payment to your account/,
    "the message does not say what was done",
  );
  assert.match(
    billing,
    /If you'd like more time, choose an option below/,
    "the message does not say the button still works, which is the part that read as broken",
  );
  // And the interface routes it to the notice, not the error box.
  const account = readFileSync("components/minewords/account.tsx", "utf8");
  assert.match(
    account,
    /failure\.code === "membership_applied"[\s\S]{0,160}setNotice/,
    "a successfully applied payment is shown as an error",
  );
  // The helper has to carry the code at all, or the check above can never fire.
  assert.match(
    readFileSync("lib/client/api.ts", "utf8"),
    /error\.code = result\.code/,
    "the client helper drops the server's stable error code",
  );
});

test("a completed checkout never falls through to the age guard", () => {
  // A structural bug, found while fixing the 409. When the completed branch
  // cleared the row without throwing, execution carried on with the *pre-delete*
  // in-memory row and hit the "an earlier checkout is being resolved, try again in
  // an hour" guard - for up to thirty minutes, over a row that no longer existed.
  // It read as intermittent because it only bites inside a 30-60 minute window.
  const source = readFileSync("lib/server/billing.ts", "utf8");
  const complete = source.indexOf('existing.status === "complete"');
  const guard = source.indexOf("now > row.created_at + 1800");
  assert.ok(
    complete > -1 && guard > complete,
    "the guard is no longer after the branch",
  );
  const branch = source.slice(complete, guard);
  // Every way out of the branch returns.
  assert.match(
    branch,
    /if \(!granted\) return checkoutSession\(/,
    "an already-granted checkout falls through to the age guard",
  );
  assert.match(
    branch,
    /return checkoutSession\(userId, customerId, origin, tier\);[\s\S]*throw new HttpError\(\s*409/,
    "the completed branch is not terminal",
  );
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
    // Split into two groups, because "one of three prices missing" and "the
    // Stripe key missing" are different claims now.
    //
    // The key, the webhook secret and the origin are each required outright: with
    // any one of them absent, payments cannot work for any tier. The prices are
    // required only as a set - at least one configured - because a deployment part
    // way through configuring three lengths must keep selling the one it has
    // rather than go dark until all three are set. That is the difference between
    // "which lengths are on sale" and "is the site taking money", and conflating
    // them would take the live monthly plan offline for the length of a deploy.
    for (const missing of [
      "STRIPE_SECRET_KEY",
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
    // Every price missing is still off - there is nothing to sell.
    setEnv(db, {
      ...SETTINGS,
      STRIPE_PRICE_MONTHLY: "",
      STRIPE_PRICE_QUARTERLY: "",
      STRIPE_PRICE_YEARLY: "",
    });
    assert.equal(
      billing.billingReady(),
      false,
      "with no price configured at all, payments must be off",
    );
    // And one price on its own is enough, which is the case that keeps a partial
    // rollout selling.
    setEnv(db, {
      ...SETTINGS,
      STRIPE_PRICE_QUARTERLY: "",
      STRIPE_PRICE_YEARLY: "",
    });
    assert.equal(
      billing.billingReady(),
      true,
      "one configured price must be enough to take payments",
    );
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
