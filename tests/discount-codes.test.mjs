/**
 * Discount codes: a tutor's 20% off the yearly term, or our own voucher at any
 * percent, counted per code.
 *
 * Ordered by how badly it goes wrong:
 *
 *   1. A code that discounts the wrong tier is a 20% cut to a price nobody
 *      agreed to - so the yearly-only rule is asserted, not assumed.
 *   2. A redemption counted twice pays a private split twice. The count is
 *      keyed on the payment intent, so a redelivered webhook recovers a lost
 *      count instead of doubling one - and that is driven, not described.
 *   3. A code that cannot be told apart when it should be (unknown vs
 *      suspended vs expired) confirms codes to anyone holding a list - one
 *      message for all three, asserted.
 *   4. The grant itself must not change: it matches the paid price id, never
 *      the amount, so a coupon-discounted yearly still grants a year.
 *
 * The harness is the one from `coupon.test.mjs`: `discount-codes.ts` reaches the
 * database through `cloudflare:workers`, which only resolves inside a module
 * runner, and Stripe is a fetch stub - no account, no network. One server for
 * the whole file, because a second one fails on the HMR port and reads like a
 * product bug.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const workersEnv = { DB: null };
globalThis.__minewordsTestEnv = workersEnv;

let runner = null;
const servers = [];
function moduleServer() {
  runner ??= createServer({
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
  }).then((open) => {
    servers.push(open);
    return open;
  });
  return runner;
}
after(async () => {
  await Promise.all(servers.map((open) => open.close()));
});

let codesModule = null;
const codes = () =>
  (codesModule ??= moduleServer().then((open) =>
    open.ssrLoadModule("/lib/server/discount-codes.ts"),
  ));
let billing = null;
const billingModule = () =>
  (billing ??= moduleServer().then((open) =>
    open.ssrLoadModule("/lib/server/billing.ts"),
  ));

const USER = "tutor-parent-1";
const YEARLY = "price_yearly_789";

function seed(db) {
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  )
    .bind(USER, "tutor-parent@example.test", "hash", 1_700_000_000, "cus_test")
    .run();
}

/** A fresh database, and the modules pointed at it. */
async function withDatabase(run) {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  workersEnv.DB = db;
  workersEnv.STRIPE_PRICE_YEARLY = YEARLY;
  workersEnv.STRIPE_SECRET_KEY = "sk_test_offline";
  try {
    return await run(db, await codes());
  } finally {
    db.close();
  }
}

/**
 * Stripe, as far as these tests are concerned.
 *
 * Records every call and answers the coupon and promotion-code endpoints from
 * canned objects. Anything else falls through to the real fetch, so a test
 * that accidentally reaches the network fails loudly rather than greenly.
 */
function stubStripe(handlers) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (!target.startsWith("https://api.stripe.com/v1/"))
      return real(target, init);
    const path = target.slice("https://api.stripe.com/v1/".length);
    const method = (init.method || "GET").toUpperCase();
    const params = new URLSearchParams(init.body?.toString?.() || "");
    calls.push({ method, path, params: Object.fromEntries(params) });
    const answer = handlers({ method, path, params });
    if (answer === undefined)
      throw new Error(`unstubbed Stripe call ${method} ${path}`);
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => answer.body ?? {},
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = real;
    },
  };
}

async function seedCode(db, overrides = {}) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO tutors (id,name,contact,status,created_at) VALUES (?,?,?,?,?)",
  )
    .bind("tutor-1", "Sarah Chen", "sarah@example.test", "active", now)
    .run();
  db.prepare(
    `INSERT INTO discount_codes
       (id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "code-1",
      "tutor-1",
      "TUTOR-SARAH-CHEN-20",
      "yearly",
      "voucher-20-yearly",
      "promo_test_1",
      20,
      100,
      now + 365 * 86_400_000,
      "active",
      now,
    )
    .run();
  if (overrides.status || overrides.expiresAt || overrides.tutorStatus) {
    if (overrides.status)
      db.prepare("UPDATE discount_codes SET status=? WHERE id='code-1'")
        .bind(overrides.status)
        .run();
    if (overrides.expiresAt)
      db.prepare("UPDATE discount_codes SET expires_at=? WHERE id='code-1'")
        .bind(overrides.expiresAt)
        .run();
    if (overrides.tutorStatus)
      db.prepare("UPDATE tutors SET status=? WHERE id='tutor-1'")
        .bind(overrides.tutorStatus)
        .run();
  }
}

test("labels name the tutor and the discount, and survive collisions", async () => {
  await withDatabase(async (_db, mod) => {
    assert.equal(
      mod.tutorCodeLabel("Sarah Chen", new Set()),
      "TUTOR-SARAH-CHEN-20",
    );
    assert.equal(
      mod.tutorCodeLabel("Sarah Chen", new Set(["TUTOR-SARAH-CHEN-20"])),
      "TUTOR-SARAH-CHEN-20-2",
    );
    assert.equal(mod.normaliseCode("  tutor-sarah-20\n"), "TUTOR-SARAH-20");
    assert.equal(mod.discountedAmount(3000, 20), 2400);
    assert.equal(mod.DISCOUNT_TIER, "yearly");
    assert.equal(mod.TUTOR_PERCENT_OFF, 20);
  });
});

test("our own vouchers are named after the promotion and carry their percent", async () => {
  await withDatabase(async (_db, mod) => {
    assert.equal(
      mod.houseVoucherLabel("Summer sale", 50, new Set()),
      "SUMMER-SALE-50",
    );
    // Typing the percent into the name is not punished with a second one.
    assert.equal(
      mod.houseVoucherLabel("Summer sale-50", 50, new Set()),
      "SUMMER-SALE-50",
    );
    // Two promotions called the same thing get -2, counted from the rows.
    assert.equal(
      mod.houseVoucherLabel("Summer sale", 50, new Set(["SUMMER-SALE-50"])),
      "SUMMER-SALE-50-2",
    );
    assert.equal(mod.voucherCouponId(50), "voucher-50-yearly");
    // TUTOR- is refused rather than sanitised: it is the prefix that files a
    // code under a tutor's rebate, and this one is not a tutor's.
    assert.throws(
      () => mod.houseVoucherLabel("TUTOR-SARAH-20", 50, new Set()),
      {
        message:
          "TUTOR- is for tutor codes. Name the voucher after the promotion.",
      },
    );
    assert.throws(() => mod.houseVoucherLabel("   ", 50, new Set()), {
      message: "Name the voucher.",
    });
  });
});

test("a voucher's percent is whole and never a hundred", async () => {
  await withDatabase(async (_db, mod) => {
    for (const percentOff of [0, 91, 12.5, Number.NaN]) {
      await assert.rejects(
        mod.issueHouseVoucher({ label: "Test", percentOff }),
        { message: "Pick a whole percent between 1 and 90." },
        `accepted ${percentOff}`,
      );
    }
  });
});

test("issuing a voucher creates its own coupon and no tutor row", async () => {
  await withDatabase(async (db, mod) => {
    const stripe = stubStripe(({ method, path }) => {
      if (method === "POST" && path === "coupons")
        return { body: { id: "voucher-50-yearly", percent_off: 50 } };
      if (method === "POST" && path === "promotion_codes")
        return { body: { id: "promo_house_1" } };
      return undefined;
    });
    try {
      const issued = await mod.issueHouseVoucher({
        label: "Summer sale",
        percentOff: 50,
      });
      assert.equal(issued.label, "SUMMER-SALE-50");
      // A coupon of its own, at its own percent: the 20% every tutor code
      // points at is not reusable for a 50% promotion.
      const coupon = stripe.calls.find(
        (c) => c.method === "POST" && c.path === "coupons",
      );
      assert.ok(coupon, "a Stripe coupon is created");
      assert.equal(coupon.params.id, "voucher-50-yearly");
      assert.equal(coupon.params.percent_off, "50");
      const promo = stripe.calls.find(
        (c) => c.method === "POST" && c.path === "promotion_codes",
      );
      assert.equal(promo.params.code, "SUMMER-SALE-50");
      assert.equal(promo.params.coupon, "voucher-50-yearly");
      const row = await db
        .prepare("SELECT * FROM discount_codes WHERE label=?")
        .bind("SUMMER-SALE-50")
        .first();
      assert.equal(row.tutor_id, null, "a voucher belongs to nobody");
      assert.equal(row.percent_off, 50);
      assert.equal(row.stripe_promotion_code_id, "promo_house_1");
      // No tutor row: a name in the rebate list that nobody is owed against is
      // exactly what tutor_id NULL avoids.
      const tutors = await db
        .prepare("SELECT COUNT(*) AS c FROM tutors")
        .first();
      assert.equal(tutors.c, 0, "issuing a voucher invented a tutor");
    } finally {
      stripe.restore();
    }
  });
});

test("a voucher is quoted, counted and suspended like any other code", async () => {
  await withDatabase(async (db, mod) => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO discount_codes
         (id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at)
       VALUES (?,NULL,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "code-house",
        "SUMMER-SALE-50",
        "yearly",
        "voucher-50-yearly",
        "promo_house_1",
        50,
        100,
        now + 365 * 86_400_000,
        "active",
        now,
      )
      .run();
    // The parent types it in any case; the lookup is by the stored form.
    const quoted = await mod.quoteDiscountCode("summer-sale-50", "yearly");
    assert.equal(quoted.label, "SUMMER-SALE-50");
    assert.equal(quoted.percentOff, 50);
    assert.equal(quoted.tutorName, null);
    assert.equal(mod.discountedAmount(3000, 50), 1500);
    await assert.rejects(mod.quoteDiscountCode("SUMMER-SALE-50", "monthly"), {
      message: "This code works on the 1-year option.",
    });
    // Counted by the same rows: a promotion reached this many families.
    db.prepare(
      "INSERT INTO purchases (id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
      .bind("p-house", USER, YEARLY, "pi_house", 0, 365 * 86_400_000, "paid", 1)
      .run();
    assert.equal(
      await mod.recordRedemption({
        paymentIntent: "pi_house",
        userId: USER,
        label: "SUMMER-SALE-50",
      }),
      true,
    );
    const stats = await mod.discountCodeStats();
    const row = stats.find((r) => r.label === "SUMMER-SALE-50");
    assert.equal(row.redeemed, 1);
    assert.equal(row.tutorId, null);
    assert.equal(row.tutorName, null);
    // And suspending it works with no tutor in the picture at all.
    const stripe = stubStripe(({ method, path }) =>
      method === "POST" && path === "promotion_codes/promo_house_1"
        ? { body: { id: "promo_house_1", active: false } }
        : undefined,
    );
    try {
      await mod.suspendDiscountCode("code-house");
    } finally {
      stripe.restore();
    }
    await assert.rejects(mod.quoteDiscountCode("SUMMER-SALE-50", "yearly"), {
      message: "That code is not valid.",
    });
  });
});

test("unknown, suspended and expired codes are refused identically", async () => {
  await withDatabase(async (db, mod) => {
    await seedCode(db);
    const message = "That code is not valid.";
    await assert.rejects(mod.quoteDiscountCode("TUTOR-NOBODY-20", "yearly"), {
      message,
    });
    await seedCodeSuspended(db, mod, { status: "suspended" }, message);
    await seedCodeSuspended(db, mod, { expiresAt: Date.now() - 1000 }, message);
    await seedCodeSuspended(db, mod, { tutorStatus: "suspended" }, message);
  });
});

async function seedCodeSuspended(db, mod, overrides, message) {
  db.prepare("DELETE FROM discount_redemptions").run();
  db.prepare("DELETE FROM discount_codes").run();
  db.prepare("DELETE FROM tutors").run();
  await seedCode(db, overrides);
  await assert.rejects(
    mod.quoteDiscountCode("TUTOR-SARAH-CHEN-20", "yearly"),
    { message },
    JSON.stringify(overrides),
  );
}

test("a code discounts the yearly term and no other", async () => {
  await withDatabase(async (db, mod) => {
    await seedCode(db);
    const quoted = await mod.quoteDiscountCode("tutor-sarah-chen-20", "yearly");
    assert.equal(quoted.label, "TUTOR-SARAH-CHEN-20");
    assert.equal(quoted.percentOff, 20);
    await assert.rejects(
      mod.quoteDiscountCode("TUTOR-SARAH-CHEN-20", "monthly"),
      {
        message: "This code works on the 1-year option.",
      },
    );
  });
});

test("a redemption counts once, even when the webhook is redelivered", async () => {
  await withDatabase(async (db, mod) => {
    await seedCode(db);
    // The purchase row the webhook's grant writes: the count is conditional on
    // it, so a payment for a price nobody sells counts for nobody.
    db.prepare(
      "INSERT INTO purchases (id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
      .bind("p1", USER, YEARLY, "pi_counted", 0, 365 * 86_400_000, "paid", 1)
      .run();
    assert.equal(
      await mod.recordRedemption({
        paymentIntent: "pi_counted",
        userId: USER,
        label: "TUTOR-SARAH-CHEN-20",
      }),
      true,
    );
    assert.equal(
      await mod.recordRedemption({
        paymentIntent: "pi_counted",
        userId: USER,
        label: "TUTOR-SARAH-CHEN-20",
      }),
      false,
      "a redelivery recovers nothing because nothing was lost",
    );
    const count = (
      await db
        .prepare(
          "SELECT COUNT(*) AS c FROM discount_redemptions WHERE payment_intent=?",
        )
        .bind("pi_counted")
        .first()
    ).c;
    assert.equal(count, 1);
    assert.equal(
      await mod.recordRedemption({
        paymentIntent: "pi_never_paid",
        userId: USER,
        label: "TUTOR-SARAH-CHEN-20",
      }),
      false,
      "no purchase row, no count",
    );
    assert.equal(
      await mod.recordRedemption({
        paymentIntent: "pi_counted",
        userId: USER,
        label: "TUTOR-NOBODY-20",
      }),
      false,
      "no such code, no count",
    );
  });
});

test("issuing creates the Stripe objects and the rows behind them", async () => {
  await withDatabase(async (db, mod) => {
    const stripe = stubStripe(({ method, path }) => {
      if (method === "POST" && path === "coupons")
        return { body: { id: "voucher-20-yearly", percent_off: 20 } };
      if (method === "POST" && path === "promotion_codes")
        return { body: { id: "promo_issued_1" } };
      return undefined;
    });
    try {
      const issued = await mod.issueTutorCode({
        tutorName: "Sarah Chen",
        contact: "sarah@example.test",
      });
      assert.equal(issued.label, "TUTOR-SARAH-CHEN-20");
      const promoCall = stripe.calls.find(
        (c) => c.method === "POST" && c.path === "promotion_codes",
      );
      assert.ok(promoCall, "a Stripe promotion code is created");
      assert.equal(promoCall.params.code, "TUTOR-SARAH-CHEN-20");
      assert.equal(promoCall.params.coupon, "voucher-20-yearly");
      assert.equal(promoCall.params.max_redemptions, "100");
      const expiresInDays =
        (Number(promoCall.params.expires_at) * 1000 - Date.now()) / 86_400_000;
      assert.ok(
        expiresInDays > 359 && expiresInDays < 361,
        `twelve thirty-day months, got ${expiresInDays} days`,
      );
      const row = await db
        .prepare("SELECT * FROM discount_codes WHERE label=?")
        .bind("TUTOR-SARAH-CHEN-20")
        .first();
      assert.equal(row.stripe_promotion_code_id, "promo_issued_1");
      // A second Sarah collides onto -2 rather than failing the issue.
      const again = await mod.issueTutorCode({ tutorName: "Sarah Chen" });
      assert.equal(again.label, "TUTOR-SARAH-CHEN-20-2");
    } finally {
      stripe.restore();
    }
  });
});

test("issuing reuses the coupon for that percent, and refuses a tampered one", async () => {
  await withDatabase(async (_db, mod) => {
    const broken = stubStripe(({ method, path }) => {
      if (method === "POST" && path === "coupons")
        return { ok: false, status: 400, body: { error: "exists" } };
      if (method === "GET" && path === "coupons/voucher-20-yearly")
        return { body: { id: "voucher-20-yearly", percent_off: 10 } };
      if (method === "POST" && path === "promotion_codes")
        return { body: { id: "promo_x" } };
      return undefined;
    });
    try {
      await assert.rejects(mod.issueTutorCode({ tutorName: "Tamper Test" }), {
        message: "The discount is misconfigured. No code was issued.",
      });
    } finally {
      broken.restore();
    }
  });
});

test("checkout attaches the promotion code and names it in metadata", async () => {
  await withDatabase(async (db) => {
    await seedCode(db);
    const billing = await billingModule();
    const stripe = stubStripe(({ method, path }) => {
      if (method === "POST" && path === "checkout/sessions")
        return { body: { id: "cs_test_1", url: "https://pay.test/cs_test_1" } };
      return undefined;
    });
    try {
      const session = await billing.checkoutSession(
        USER,
        "cus_test",
        "https://example.test",
        "yearly",
        { label: "TUTOR-SARAH-CHEN-20", promotionCodeId: "promo_test_1" },
      );
      assert.equal(session.url, "https://pay.test/cs_test_1");
      const create = stripe.calls.find(
        (c) => c.method === "POST" && c.path === "checkout/sessions",
      );
      assert.ok(create, "a Stripe session is created");
      assert.equal(
        create.params["discounts[0][promotion_code]"],
        "promo_test_1",
        "the discount rides on the session, so the price id is untouched",
      );
      assert.equal(
        create.params["metadata[discount_code]"],
        "TUTOR-SARAH-CHEN-20",
        "and the label rides in metadata for the webhook to count",
      );
      assert.equal(
        create.params["line_items[0][price]"],
        YEARLY,
        "the price is still the yearly price: the grant matches on it",
      );
    } finally {
      stripe.restore();
    }
  });
});

test("suspending stops validation here and deactivates at Stripe", async () => {
  await withDatabase(async (db, mod) => {
    await seedCode(db);
    const stripe = stubStripe(({ method, path }) => {
      if (method === "POST" && path === "promotion_codes/promo_test_1")
        return { body: { id: "promo_test_1", active: false } };
      return undefined;
    });
    try {
      await mod.suspendDiscountCode("code-1");
      const deactivate = stripe.calls.find(
        (c) => c.method === "POST" && c.path === "promotion_codes/promo_test_1",
      );
      assert.ok(deactivate, "Stripe is told first");
      assert.equal(deactivate.params.active, "false");
      await assert.rejects(
        mod.quoteDiscountCode("TUTOR-SARAH-CHEN-20", "yearly"),
        { message: "That code is not valid." },
      );
    } finally {
      stripe.restore();
    }
  });
});
