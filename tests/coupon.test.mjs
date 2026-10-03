/**
 * Coupons: access a parent is given rather than pays for.
 *
 * Ordered by how badly it goes wrong, because the first property is the one that
 * makes the rest matter:
 *
 *   1. Only an administrator can issue a code. Everything below is worthless if a
 *      parent can mint their own year.
 *   2. A code cannot be spent twice - not by a retry, not by two parents racing,
 *      and not by one parent submitting the same code again.
 *   3. Redeeming extends rather than replaces, so paying for a renewal early is
 *      not how a parent loses three months they had already bought.
 *   4. The grant and the audit row happen together, because the schema's stated
 *      invariant - one writer of `expiry_date`, and the webhook is that writer -
 *      is satisfied by a second writer only if it leaves the same evidence.
 *   5. The code is not guessable, and a wrong one is refused without revealing
 *      whether it ever existed.
 *   6. A request from another site is refused, and so is an unauthenticated one.
 *
 * The alphabet and length are asserted rather than assumed, because "long enough
 * not to be enumerated" is only true while the code is what this says it is - and
 * shortening it is a one-character edit that no test would otherwise notice.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { resolve } from "node:path";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";

const USER = "user_1";
const CUSTOMER = "cus_123";
const PRICE = "price_monthly_123";
const QUARTERLY = "price_quarterly_456";

/**
 * The behavioural half of this file.
 *
 * Everything above asserts on the *source*, which is the right tool for a rule
 * about how something is written - one transaction, one conditional UPDATE - but
 * it cannot tell you the code adds 90 days to an account. It reads the same
 * whether the arithmetic says `+ days` or `+ days * 0`. `redeemCoupon` is the
 * second writer of `expiry_date` in this app, and a school-funded code is the
 * kind of thing that is issued once and never checked again, so it is worth
 * driving for real at least once per duration.
 *
 * The harness is the one from `stripe-billing.test.mjs`, for the same reason it
 * is there: `coupon.ts` reaches the database through `cloudflare:workers`, which
 * only resolves inside a module runner. One server for the whole file, because a
 * server per test held an HMR socket open each time and stalled the run.
 */
const workersEnv = { DB: null };
globalThis.__minewordsTestEnv = workersEnv;

let couponModule = null;
function coupon() {
  couponModule ??= moduleServer().then((open) =>
    open.ssrLoadModule("/lib/server/coupon.ts"),
  );
  return couponModule;
}

/**
 * One module runner for the whole file.
 *
 * Shared, and shared deliberately. Each server binds an HMR socket on a fixed
 * port, so the second one in a process fails with "Port 24678 is already in
 * use" - which fails the tests rather than the harness, and reads like a product
 * bug. `stripe-billing.test.mjs` found this the same way. Both modules are loaded
 * from this one server for the same reason: they are being tested meeting each
 * other, so they have to be the same ones.
 *
 * `createServer` resolves to the server, so the handle is kept resolved - closing
 * a promise is not a thing, and an `after` hook that tried would hang the run.
 */
let runner = null;
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
    // A Vite server holds its file watcher and sockets open, so the test process
    // would never exit on its own. Closing has to be awaited, which an "exit"
    // listener cannot do, so it happens after the last test instead.
    servers.push(open);
    return open;
  });
  return runner;
}
const servers = [];
after(async () => {
  await Promise.all(servers.map((open) => open.close()));
});

function seed(db) {
  db.prepare(
    "INSERT INTO users (id,email,password,created_at,customer_id,rewards_initialized) VALUES (?,?,?,?,?,0)",
  )
    .bind(USER, "parent@example.test", "hash", 1_700_000_000, CUSTOMER)
    .run();
}

/**
 * A clock the test moves by hand, for the same reason `stripe-billing.test.mjs`
 * has one: every expiry this writes is `MAX(expiry_date, now) + days`, so an
 * assertion against the real clock can only be a tolerance, and a tolerance wide
 * enough to survive a loaded machine also hides a term that is a whole day
 * short. Held still the answer is exact.
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

const DAY = 86_400_000;
const expiryOf = async (db, userId = USER) =>
  (
    await db
      .prepare("SELECT expiry_date FROM users WHERE id=?")
      .bind(userId)
      .first()
  ).expiry_date;
const rows = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;

/** A fresh database with one parent on it, and the module pointed at it. */
async function withParent(run) {
  const db = openLocalDatabase(":memory:", resolve("drizzle"));
  seed(db);
  workersEnv.DB = db;
  // Only the monthly price, because that is the one `grant` below buys. Without
  // it `priceFor` resolves to an empty string, `grantPurchase` grants nothing,
  // and the mixed tests would quietly be testing coupons alone.
  workersEnv.STRIPE_PRICE_MONTHLY = PRICE;
  workersEnv.STRIPE_PRICE_QUARTERLY = QUARTERLY;
  workersEnv.STRIPE_SECRET_KEY = "sk_test_offline";
  try {
    return await run(db, await coupon());
  } finally {
    db.close();
  }
}

/**
 * Grant a paid term the way the webhook does.
 *
 * `grantPurchase` lives in `lib/server/billing.ts`, and the point of these tests
 * is the two writers meeting - so it is called for real rather than faked with a
 * direct UPDATE. A direct write would make these tests pass even if the two
 * writers disagreed about how a term is added, which is the thing worth knowing.
 */
let billing = null;
const billingModule = () =>
  (billing ??= moduleServer().then((open) =>
    open.ssrLoadModule("/lib/server/billing.ts"),
  ));

/** A paid purchase, granted exactly as the webhook grants it. */
const grant = (paymentIntentId, priceId = PRICE) =>
  billingModule().then((mod) =>
    mod.grantPurchase(paymentIntentId, USER, priceId),
  );

const server = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** Comments stripped, so prose about a rule cannot satisfy the rule. */
const code = (name) =>
  server(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * The same source with runs of whitespace collapsed to single spaces.
 *
 * Only for assertions about *which statement is where* - an `indexOf`, or a
 * `[^;]*` that has to span a SQL string wrapped across lines. Without it every
 * such assertion silently depends on how that one string happens to be laid out,
 * and reformatting the file breaks tests that were never about formatting.
 *
 * Kept separate from `code()` rather than folded into it: collapsing whitespace
 * everywhere also rewrites the newlines that several regexes anchor on, so the
 * blunt version breaks assertions it has no business touching.
 */
const flat = (name) => code(name).replace(/\s+/g, " ");

test("only an administrator can issue a code", () => {
  const route = code("app/api/admin/route.ts");
  // Every handler, not just the first: a GET that listed codes would be the same
  // breach as a POST that made them.
  const handlers = route.match(/export async function (GET|POST)/g) ?? [];
  assert.ok(handlers.length >= 2, "the admin surface has no handlers to check");
  assert.equal(
    (route.match(/requireAdmin\(request\)/g) ?? []).length,
    handlers.length,
    "an admin handler does not check who is calling it",
  );

  // And the check is a column on the account, not an address in the source.
  const admin = code("lib/server/admin.ts");
  assert.match(admin, /SELECT is_admin FROM users WHERE id = \?/);
  // A quoted string shaped like an address: an @ followed by a dotted domain. The
  // dotted part is what separates a hardcoded address from the "@/lib/..." of an
  // import specifier, which is the only other quoted string here containing an @.
  assert.doesNotMatch(
    admin + route,
    /"[^"\n]*@[^"\n]*\.[a-z]{2,}[^"\n]*"/i,
    "authority is compared against a hardcoded address instead of read from the account",
  );
  assert.doesNotMatch(
    admin + route,
    /\.email\s*(===|!==|==|!=)|gmail/i,
    "authority is decided by comparing an address rather than by reading is_admin",
  );
  // 404 rather than 403, so the surface is not advertised to a parent who asks.
  assert.match(admin, /HttpError\(404/);
});

test("a code cannot be spent twice, however it is tried", () => {
  const coupon = code("lib/server/coupon.ts");
  const claim = coupon.match(
    /UPDATE coupons SET[\s\S]*?WHERE code=\? AND status='unused'[\s\S]*?RETURNING[\s\S]*?;/,
  );
  assert.ok(claim, "no single-statement claim of an unspent code was found");
  // The claim is one statement and its predicate includes the unspent condition,
  // which is what makes two racing redemptions produce one grant. A read followed
  // by a write would leave that window open.
  assert.match(
    claim[0],
    /status='unused'/,
    "the claim is not conditional on the code being unspent",
  );
  // The claim reads nothing. Matched against the statement's own text only, up to
  // its terminating quote-and-comma rather than the next semicolon - the claim
  // sits first in a batch, so a semicolon-delimited window runs on into the two
  // statements after it, and their subqueries are then read as the claim's.
  // Up to the statement's own terminating quote rather than the next semicolon: the
  // claim sits first in a batch, so a semicolon-delimited window runs on into the
  // two statements after it, and their subqueries are then read as the claim's.
  const statement = flat("lib/server/coupon.ts").match(
    /UPDATE coupons SET status='redeemed'[^;]*?RETURNING id, days/,
  );
  assert.ok(statement, "the claim statement was not found");
  assert.doesNotMatch(
    statement[0],
    /SELECT/i,
    "the claim reads the code before spending it, which is a race",
  );
  // And the grant is conditional on this delivery having written the audit row,
  // rather than on "the code is redeemed" - which is true on a replay, and so
  // guards nothing. Anchored to the statement, because the lazy way of writing
  // this runs past the grant and is satisfied by the audit row's own EXISTS.
  assert.match(
    flat("lib/server/coupon.ts"),
    /UPDATE users SET expiry_date[^;]*?EXISTS \(SELECT 1 FROM purchases WHERE id = \?\)/,
    "the grant is not conditional on this delivery's own audit row, so a replay grants a second term",
  );
  // And the audit row collapses rather than raising the UNIQUE index as a raw
  // database error, which is what a parent pressing the button twice would hit.
  assert.match(
    coupon,
    /ON CONFLICT\(confirmation\) DO NOTHING/,
    "a replayed redemption raises a UNIQUE violation instead of collapsing",
  );
  // The pairing, read off the flattened source rather than counted in the original.
  // Deliberately not anchored on how many lines the call takes: `prettier` will
  // lay `throw new HttpError(400, "…")` out as one line or four depending on the
  // day, and the rule being checked is "an unclaimed code is refused", not where
  // the line breaks fell.
  const source = flat("lib/server/coupon.ts");
  const refuse =
    /if \((!claimed[^)]*)\)([\s\S]{0,200}?)throw new HttpError\(\s*400,/.exec(
      source,
    );
  assert.ok(refuse, "a code that was never claimed is not refused");
  assert.match(
    refuse[1],
    /\.results\?\.length/,
    "the refusal is not keyed on the claim having returned a row",
  );
});

test("the claim, the grant and the audit row are one transaction", () => {
  // The claim spent a twenty-character code worth up to a year. It was outside the
  // batch for a while, and the consequence was a real loss: a Worker evicted, or
  // any error, between the two statements burned the code and extended nothing,
  // and the parent's retry was told it had already been used. Recovery was a
  // person issuing a new code by hand.
  //
  // All three therefore have to be inside the same `db.batch`, which D1 runs as a
  // single transaction.
  //
  // Positions read off the flattened source, because these SQL strings are wrapped
  // across lines and the question is which statement comes first.
  const one = flat("lib/server/coupon.ts");
  const claimAt = one.indexOf("UPDATE coupons SET status='redeemed'");
  const grantAt = one.indexOf("UPDATE users SET expiry_date");
  const auditAt = one.indexOf("INSERT INTO purchases");
  assert.ok(claimAt > -1, "the claim is not written");
  assert.ok(grantAt > claimAt, "the grant is not written");
  // `db.batch([` rather than a literal match on the call: the batch is generic over
  // the row shape its first statement returns, so the call reads
  // `db.batch<{...}>([` and a literal "db.batch([" is not in the file at all.
  const opened = one.lastIndexOf("db.batch", claimAt);
  assert.ok(
    opened > -1 && opened < claimAt,
    "the claim is not inside a batch, so it can be spent without the grant landing",
  );
  // And nothing between them leaves the transaction: a read or a write in the
  // middle is a second thing that can fail on its own.
  const body = one.slice(opened, grantAt + 400);
  assert.doesNotMatch(
    body,
    /\.first\(|\.all\(\)/,
    "a read outside the batch sits between the claim and the grant",
  );
  // The audit row is written BEFORE the grant, which is the reverse of
  // `grantPurchase`'s order and is not a mistake: this statement reads
  // `users.expiry_date`, so written afterwards it would read the value the grant
  // had just written, and the row would claim the account had already been
  // extended when it had not - and run until twice the length the code was worth.
  assert.ok(
    auditAt < grantAt,
    "the audit row reads the account after the grant has extended it",
  );
  // Which is also why the audit row can be the sentinel the grant is keyed on: the
  // id is a UUID minted per call, before the batch, so the row is there only if
  // this delivery is the one that wrote it. Generated before the batch rather than
  // inside it, because a value the batch computes cannot be handed to a statement
  // in the same batch.
  assert.match(one, /id = crypto\.randomUUID\(\)/);
  assert.ok(
    one.indexOf("id = crypto.randomUUID()") < opened,
    "the sentinel id is generated inside the batch, so the grant cannot be keyed on it",
  );
  // `confirmation` is unique, so a retry collapses rather than double-recording.
  // The prefix comes from the shared constant rather than a literal, because the
  // account page decides "is this row a code" by testing that same prefix - and
  // two literals is exactly how a code comes to be labelled as a purchase.
  assert.match(body, /COUPON_CONFIRMATION_PREFIX/);
  assert.match(
    flat("lib/server/coupon.ts"),
    /export const COUPON_CONFIRMATION_PREFIX = "coupon:"/,
    "the redemption prefix is a bare literal again, so it can drift from the reader",
  );
});

test("redeeming extends the access already there rather than replacing it", () => {
  const coupon = code("lib/server/coupon.ts");
  // MAX(COALESCE(expiry_date, 0), now) + days: from the later of now and the
  // current expiry. A plain assignment would let a coupon redeemed early destroy
  // time that was paid for.
  //
  // The length is read from the code inside the statement, as
  // `COALESCE((SELECT days FROM coupons WHERE code = ?), 0) * 86400000`, rather
  // than bound in as a number - which is what lets the claim sit in the same
  // transaction as the grant. The `COALESCE` is not decoration: it is the reason a
  // code that does not exist adds zero rather than NULLing the column.
  assert.match(
    coupon,
    /expiry_date = MAX\(COALESCE\(expiry_date, 0\), \?\)\s*\n\s*\+ COALESCE\(\(SELECT days FROM coupons WHERE code = \?\), 0\) \* 86400000/,
    "the new expiry is not computed from the later of now and the current expiry",
  );
  // And the length is the code's own `days`, never a number worked out elsewhere:
  // a second place deciding what a month is worth is a second thing to get wrong.
  assert.doesNotMatch(
    coupon,
    /expiresAt\s*[+*]/,
    "the extension is computed in JS from a read taken before the write, which races two codes redeemed at once",
  );
});

test("the audit row answers where the new expiry came from", () => {
  // The batching is covered by "the claim, the grant and the audit row are one
  // transaction". What is left is the half that is not about transactions: this
  // row is what answers "why does my child have access until March", so its dates
  // have to be the account's own rather than a figure worked out beside it.
  const source = flat("lib/server/coupon.ts");
  assert.match(
    source,
    /INSERT INTO purchases[\s\S]*?\(SELECT expiry_date FROM users WHERE id = \?\)/,
    "the audit row does not read the account's own expiry as its base",
  );
  // Written as 0 at first, which the account page rendered as "Access then ran
  // until 1 January 1970".
  assert.doesNotMatch(
    source,
    /INSERT INTO purchases[^\`]*VALUES[^\`]*,\s*0\s*,\s*0\s*,/,
    "the audit row still writes placeholder dates",
  );
});

test("a code is never presented to the parent as something they paid for", () => {
  // The one that is about money rather than about access. A code is paid for by
  // somebody else - a school, a grandparent, a sponsor - which is the only reason
  // it exists, and `purchases` is the table that accounts for what this account
  // has spent. So a redemption appearing in it as "Paid" tells a parent they
  // have been charged for something they were given, and there is no way for
  // them to tell from the screen that they were not.
  //
  // It got there two ways at once, and both had to be closed. The server labelled
  // every row whose `product_id` was not a configured price id as the bare word
  // "Access" - which is also the fallback for a price id nothing maps to, so a
  // code and a mystery purchase were indistinguishable. And the page rendered
  // every status that was not "refunded" as "Paid", so the label was not the
  // only thing wrong.
  const route = code("app/api/billing/[action]/route.ts");
  const account = code("components/minewords/account.tsx");

  // The duration has to come from the code, because `purchases` records a payment
  // as a price id and a code has none. It is reached by the join rather than by a
  // new column, so this asserts the join is what is there.
  assert.match(
    route,
    // The prefix comes from the shared constant rather than a literal, on both sides.
    // The account page decides "is this row a code" by testing that same prefix, so
    // two literals is exactly how a code ends up labelled as a purchase - and being
    // wrong in that direction is what this whole test exists to prevent.
    /LEFT JOIN coupons c ON p\.confirmation = '\$\{COUPON_CONFIRMATION_PREFIX\}' \|\| c\.id/,
    "the history joins on a literal prefix, which can drift from the one redemption writes",
  );
  // And the code branch names the code, rather than falling through to the "Access"
  // label that an unmapped price id still legitimately gets. Written as a positive
  // assertion because forbidding `?? "Access"` outright would also forbid the
  // fallback for a purchase whose price setting has since been removed - which is a
  // different row and a different question.
  assert.match(
    flat("app/api/billing/[action]/route.ts"),
    /label: isCode[\s\S]{0,200}\? CODE_LABEL[\s\S]{0,120}lengthLabel\(coupon\)\} code`/,
    "a code is not labelled as a code with the length it was worth",
  );
  // With no code row left to read a length from, it is called a code and given no
  // length - `lengthLabel(0)` would have called it "0 days", which claims the code
  // was worth nothing rather than that we can no longer see what it was worth.
  assert.match(
    flat("app/api/billing/[action]/route.ts"),
    /const CODE_LABEL = "Code"/,
  );
  // And the interface is told which rows are codes, rather than re-deriving it.
  assert.match(
    route,
    /viaCode/,
    "the page is not told which history rows are codes",
  );
  assert.match(account, /viaCode/);
  // Which rows are codes comes from `confirmation`, not from the join. The join is
  // a LEFT one so the row survives its code being deleted, which means a null from
  // it says "not a code *or* no code left" - and reading it as "not a code" put a
  // deleted code's row back in front of the parent labelled "Paid". The prefix is
  // the fact; the join is only where the length is stored.
  assert.match(
    route,
    /const isCode = row\.confirmation\.startsWith\(COUPON_CONFIRMATION_PREFIX\)/,
    "whether a row is a code is decided by the join, which goes null when the code is deleted",
  );
  assert.match(route, /viaCode: isCode/);
  // Three states in the status cell, not two. This is the assertion that would
  // have caught the code reading as "Paid". The window is wider because the cell
  // grew a branch for a code whose length is no longer readable.
  assert.match(
    account,
    /purchase\.status === "refunded"[\s\S]{0,400}?purchase\.viaCode[\s\S]{0,400}?"Paid"/,
    "the status cell does not distinguish a redeemed code from a paid purchase",
  );
  // And a code with no readable length does not claim to have been worth zero
  // days, which is what `days` reads as once its `coupons` row is gone. Asserted
  // as the guard rather than as the absence of the sentence: the sentence is
  // right when there is a length to print, and the bug was only ever that it was
  // printed when there was not. Matched against the comment-stripped source,
  // because the comment above that branch quotes the old shape to explain it.
  assert.match(
    code("components/minewords/account.tsx"),
    /purchase\.viaCode[\s\S]{0,80}?purchase\.days\s*\?\s*`Code redeemed — \$\{purchase\.days\} days[\s\S]{0,120}?"Code redeemed — at no charge"/,
    'a code with no readable length is printed as "0 days"',
  );
  // The heading above it claimed the parent bought everything in the table.
  assert.doesNotMatch(
    account,
    /What you have bought/,
    "a table containing codes is still captioned as purchases",
  );
  // A code is hardship support - issued by us to a family who is finding the cost
  // difficult - so it is never "paid for by someone else" either. That phrasing
  // implies a third party bought a gift, which is not what a code is: nobody spent
  // anything, and a parent who is struggling should never be shown a payer.
  for (const [file, label] of [
    ["components/minewords/account.tsx", "the account history table"],
    ["components/minewords/coupon-redeem.tsx", "the code entry form"],
    ["components/minewords/landing.tsx", "the landing page"],
  ]) {
    assert.doesNotMatch(
      code(file),
      /paid for by someone else|being paid for by someone else/i,
      `${label} still describes a code as paid for by a third party, which is not what a hardship code is`,
    );
  }
  assert.doesNotMatch(
    code("components/minewords/coupon-redeem.tsx"),
    /grandparent|sponsor/i,
    "the code form still describes a code as a gift from a grandparent or sponsor",
  );
  assert.match(
    code("components/minewords/account.tsx"),
    /at no charge/,
    "a redeemed code is not marked as free",
  );
  // The admin screen says what a code is for, and it is the screen where that
  // matters most - this is the page somebody reads before deciding whether to
  // issue one.
  assert.match(
    code("components/minewords/admin.tsx"),
    /hardship|who has told you the cost is a problem/i,
    "the admin screen does not say that codes are hardship support",
  );
  assert.doesNotMatch(
    code("components/minewords/admin.tsx"),
    /grandparent|sponsor|whoever is paying/i,
    "the admin screen still describes codes as gifts from a third party",
  );
  // And the summary sentence and the table must agree about which rows exist -
  // they disagreed, because the sentence filtered on `status === "paid"` and so
  // omitted every code while the table listed it.
  assert.doesNotMatch(
    account,
    /filter\(\(p\) => p\.status === "paid"\)/,
    "the summary still drops every redeemed code",
  );
});

for (const days of [30, 90, 365]) {
  test(`a redeemed code adds exactly ${days} days`, async () => {
    // The arithmetic, run rather than read. A code is issued once, by hand, and
    // never looked at again - so if `days` is read from the wrong place, or the
    // term is added from the wrong base, the family who was given it finds out
    // when the child loses access early, and nobody has a log to check.
    const clock = fakeClock(1_800_000_000_000);
    try {
      await withParent(async (db, mod) => {
        const { batch, codes } = await mod.issueCoupons(days, 1);
        const t0 = clock.now();
        const redeemed = await mod.redeemCoupon(USER, codes[0]);
        assert.equal(
          redeemed.days,
          days,
          "the code was worth a different length",
        );
        assert.equal(
          await expiryOf(db),
          t0 + days * DAY,
          "the account did not gain exactly the code's own length",
        );
        assert.equal(redeemed.expiresAt, t0 + days * DAY);
        // And it is recorded, because a parent asking why their child has access
        // until March needs an answer that is not in their own head.
        const ledger = await rows(
          db,
          "SELECT * FROM purchases WHERE user_id=?",
          USER,
        );
        assert.equal(ledger.length, 1, "the redemption left no record");
        assert.equal(ledger[0].new_expiry, t0 + days * DAY);
        assert.equal(ledger[0].status, "redeemed");
        // The batch is echoed so a failing test names which batch went wrong.
        assert.ok(batch && codes[0], "the code was not issued");
      });
    } finally {
      clock.restore();
    }
  });
}

test("codes and purchases compose, in any order, and the expiry only moves forward", async () => {
  // The property the owner asked about: buy more, or be given more, and the date
  // keeps rolling forward rather than being replaced. Checked in one interleaved
  // run because the interesting failure is not "one of them is wrong" - it is
  // "the second one overwrote the first", which only shows up when they meet.
  const clock = fakeClock(1_800_000_000_000);
  try {
    await withParent(async (db, mod) => {
      const { codes } = await mod.issueCoupons(90, 1);
      const { codes: yearly } = await mod.issueCoupons(365, 1);
      const t0 = clock.now();

      const steps = [
        ["code", () => mod.redeemCoupon(USER, codes[0]), 90],
        ["purchase", () => grant("pi_1"), 30],
        ["code", () => mod.redeemCoupon(USER, yearly[0]), 365],
        ["purchase", () => grant("pi_2", QUARTERLY), 90],
      ];
      let expected = t0;
      for (const [what, act, days] of steps) {
        expected += days * DAY;
        await act();
        const actual = await expiryOf(db);
        assert.equal(
          actual,
          expected,
          `after the ${what} worth ${days} days the expiry was wrong`,
        );
      }
      // 90 + 30 + 365 + 90.
      assert.equal(await expiryOf(db), t0 + 575 * DAY);

      // And the ledger accounts for all four, each naming what it was worth.
      const ledger = await rows(
        db,
        "SELECT * FROM purchases WHERE user_id=? ORDER BY rowid",
        USER,
      );
      assert.equal(ledger.length, 4, "a grant left no record");
      assert.deepEqual(
        ledger.map((r) => r.status),
        ["redeemed", "paid", "redeemed", "paid"],
      );
      // The audit trail never goes backwards, because that is the column
      // `revokePurchase` reads to work out how much to take back.
      let previous = 0;
      for (const row of ledger) {
        assert.ok(
          row.new_expiry > previous,
          `the ledger went backwards: ${previous} then ${row.new_expiry}`,
        );
        previous = row.new_expiry;
      }
    });
  } finally {
    clock.restore();
  }
});

test("buying while a code is running never shortens it", async () => {
  // The one direction that loses money silently. A school funds a term, the
  // family buys another before it ends, and the grant has to add to the code
  // rather than measure from today - otherwise the code's remaining days are
  // gone and nobody is told.
  const clock = fakeClock(1_800_000_000_000);
  try {
    await withParent(async (db, mod) => {
      const { codes } = await mod.issueCoupons(365, 1);
      const { codes: month } = await mod.issueCoupons(30, 1);
      const t0 = clock.now();
      await mod.redeemCoupon(USER, codes[0]);
      const funded = await expiryOf(db);
      assert.equal(funded, t0 + 365 * DAY);

      // Ten days later the school buys them a month as well.
      clock.advance(10 * DAY);
      await mod.redeemCoupon(USER, month[0]);
      const both = await expiryOf(db);
      assert.equal(
        both,
        funded + 30 * DAY,
        "the second code measured from today rather than from the code still running",
      );
      assert.ok(both > t0 + 394 * DAY, "the family is short of both codes");

      // And a purchase on top of that, which is the same property one writer
      // over.
      await grant("pi_1");
      assert.equal(
        await expiryOf(db),
        funded + 60 * DAY,
        "a purchase did not add to the codes already running",
      );
    });
  } finally {
    clock.restore();
  }
});

test("a spent code cannot be spent again, and the refusal adds no time at all", async () => {
  // The refusal half of the double-spend rule. A second attempt that threw but
  // still wrote the expiry would be worse than one that threw and wrote nothing:
  // the parent would be told it failed while quietly being given the time twice.
  const clock = fakeClock(1_800_000_000_000);
  try {
    await withParent(async (db, mod) => {
      const { codes } = await mod.issueCoupons(90, 1);
      await mod.redeemCoupon(USER, codes[0]);
      const after = await expiryOf(db);
      for (const attempt of [2, 3]) {
        await assert.rejects(
          () => mod.redeemCoupon(USER, codes[0]),
          (error) => {
            assert.equal(error.status, 400);
            return true;
          },
          `attempt ${attempt} was allowed to spend the same code again`,
        );
        assert.equal(
          await expiryOf(db),
          after,
          `attempt ${attempt} refused the code but still moved the expiry`,
        );
      }
      // One row for one code, however many times it is offered.
      assert.equal(
        (await rows(db, "SELECT * FROM purchases WHERE user_id=?", USER))
          .length,
        1,
      );
    });
  } finally {
    clock.restore();
  }
});

test("a code is long enough not to be guessed", () => {
  const coupon = code("lib/server/coupon.ts");
  const length = /const CODE_LENGTH = (\d+)/.exec(coupon);
  assert.ok(length, "no code length is declared");
  const n = Number(length[1]);
  // 20 characters from a 30-symbol alphabet is 20 * log2(30) ~= 98 bits. The test
  // is on the product, so an alphabet change that quietly shortens the space
  // still has to pass a deliberate edit rather than slipping through.
  const alphabet = /const ALPHABET = "([^"]+)"/.exec(coupon);
  assert.ok(alphabet, "no alphabet is declared");
  const entropy = n * Math.log2(alphabet[1].length);
  assert.ok(
    entropy >= 80,
    `a code carries ${entropy.toFixed(0)} bits, which is enumerable`,
  );
  assert.equal(
    new Set(alphabet[1].split("")).size,
    alphabet[1].length,
    "the alphabet repeats a character, so the space is smaller than it looks",
  );
  // Lookalikes are excluded so a code read aloud cannot become a second code.
  for (const character of "IO01") {
    assert.ok(
      !alphabet[1].includes(character),
      `${character} is in the alphabet and can be misread as another character`,
    );
  }
});

test("a code is normalised the way a parent will type it", () => {
  const normalise = /export function normaliseCode[\s\S]*?\n}/.exec(
    code("lib/server/coupon.ts"),
  );
  assert.ok(normalise, "no normalisation");
  assert.match(
    normalise[0],
    /toUpperCase\(\)/,
    "a lower-case code is refused, so a code read from an email does not work",
  );
  assert.match(
    normalise[0],
    /replace\(\/\[\^A-Z0-9\]\/g, ""\)/,
    "punctuation is not stripped, so a hyphenated code is refused",
  );
  // Length is checked after normalisation, against the same constant the codes
  // are built with - otherwise the check and the generator can disagree.
  const coupon = code("lib/server/coupon.ts");
  assert.match(coupon, /code\.length !== CODE_LENGTH/);
});

test("a wrong code and a spent code are refused identically", () => {
  // Keyed on the condition that is actually there. It was `if (!claimed)`, which
  // no longer reads that way: the claim statement ends in `RETURNING`, so a
  // statement that returns rows reports a change count of zero however many it
  // matched, and the success path has to be read off the returned row instead.
  //
  // Matched against the flattened source so it does not depend on how the block is
  // indented or how the call is wrapped. Both were anchored on formatting once -
  // the closing brace as `\n  }`, the call as `HttpError(400, "…"` - and
  // `prettier --write` on this file was enough to fail the test. The rules being
  // checked are "an unclaimed code is refused" and "with one message", not where
  // the line breaks fell.
  const coupon = flat("lib/server/coupon.ts");
  const branch = /if \(!claimed\?\.results\?\.length\)([\s\S]*?)\}/.exec(
    coupon,
  );
  assert.ok(branch, "an unclaimed code is not refused at all");
  // One message for both cases, and it has to cover both: a parent who mistyped
  // and a parent who spent it are both refused, so naming only one of them would
  // tell anyone holding a list of codes which are real.
  const messages = branch[1].match(/HttpError\(\s*400,\s*"([^"]+)"/g) ?? [];
  assert.equal(
    messages.length,
    1,
    "the unclaimed branch answers with more than one message, so the two cases differ",
  );
  assert.match(
    messages[0],
    /not valid/i,
    "the refusal does not cover a code that never existed",
  );
  assert.match(
    messages[0],
    /already been used/i,
    "the refusal does not cover a code that was already spent",
  );
  // No branch anywhere in the module that can tell the two apart.
  assert.equal(
    (coupon.match(/not valid, or has already been used/g) ?? []).length,
    1,
    "the same refusal is spelled more than once, which is how the two cases drift apart",
  );
});

test("the redemption endpoint is authenticated, same-origin and rate limited", () => {
  const route = code("app/api/coupon/route.ts");
  assert.match(route, /requireUser\(request\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(
    route,
    /rateLimit\(`coupon:\$\{user\.id\}`, \d+\)/,
    "redemption is not limited per account",
  );
  assert.match(
    route,
    /cf-connecting-ip/,
    "redemption is not limited per address, so one account cannot be ground down from many IPs",
  );
  // The limit is applied before the code is looked at.
  assert.ok(
    route.indexOf("rateLimit(") < route.indexOf("redeemCoupon("),
    "the code is redeemed before the request is limited",
  );
});

test("the admin page is not linked from anywhere a parent would find it", () => {
  // Not a security property - `/api/admin` refuses a parent whatever the page
  // says. It is about not advertising the surface, and about there being one
  // place that decides rather than a link per page that might be forgotten.
  for (const page of [
    "components/minewords/header.tsx",
    "components/minewords/account.tsx",
  ]) {
    assert.doesNotMatch(
      server(page),
      /href=["']\/admin/,
      `${page} links to /admin, so a parent is shown an administrator's page`,
    );
  }
});
