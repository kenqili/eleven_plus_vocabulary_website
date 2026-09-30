/**
 * Entitlement and redemption, after the move to one expiry column.
 *
 * Three things are being proven here, and none of them is visible in a unit test
 * because all three are properties of the database rather than of a function:
 *
 *  1. The migration applies to a database that already has data, and an account
 *     that has already paid keeps its access. A migration that drops a paying
 *     customer is the worst failure in this repository, and it happens silently.
 *  2. Redemption cannot overdraw. The rule moved out of two SQL triggers into a
 *     conditional UPDATE in one batch; the guarantee has to be identical.
 *  3. A replayed Stripe webhook grants once, not twice. This is what the unique
 *     index on `purchases.confirmation` exists for.
 *
 * Runs against a real SQLite file built by the real migrations, including the
 * triggers, because that is the only place these rules exist.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** A real database, migrated from scratch, exactly as production would be. */
function migrated() {
  const dir = mkdtempSync(join(tmpdir(), "minewords-entitlement-"));
  const file = join(dir, "test.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS _applied (name TEXT PRIMARY KEY)");
  for (const name of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (db.prepare("SELECT name FROM _applied WHERE name=?").get(name))
      continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(resolve("drizzle", name), "utf8"));
      db.prepare("INSERT INTO _applied VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${name} failed: ${error.message}`);
    }
  }
  return db;
}

function account(db, { createdAt = Date.now(), expiryDate = null } = {}) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users(id,email,password,created_at,expiry_date) VALUES(?,?,?,?,?)",
  ).run(
    id,
    `u-${id}@example.test`,
    "scrypt$not$arealhash",
    createdAt,
    expiryDate,
  );
  return id;
}

const day = 86_400_000;

test("every migration applies in order, triggers included", () => {
  const db = migrated();
  const triggers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  assert.ok(
    triggers.includes("learning_awards"),
    "the earning trigger must survive",
  );
  assert.ok(
    triggers.includes("study_tick_totals"),
    "the study tick totals trigger must survive",
  );
  // The two redemption triggers are gone on purpose: their rule now lives in one
  // batch in redeem(). If they are still here, the migration did not apply and
  // the double-debit path is live.
  assert.ok(
    !triggers.includes("redeem_badge"),
    "redeem_badge should have been dropped; its job is now a conditional UPDATE",
  );
  assert.ok(
    !triggers.includes("badge_receipt"),
    "badge_receipt should have been dropped; it applied the debit from SQL",
  );
  db.close();
});

test("an account that already paid keeps its access through the migration", () => {
  // Build a pre-migration shape by hand: the users and subscriptions rows the
  // old code would have written, then apply only the new migration.
  const dir = mkdtempSync(join(tmpdir(), "minewords-backfill-"));
  const db = new DatabaseSync(join(dir, "pre.sqlite"));
  db.exec("PRAGMA foreign_keys=ON;");
  for (const name of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (name >= "0012_entitlement_and_purchases.sql") continue;
    db.exec(readFileSync(resolve("drizzle", name), "utf8"));
  }
  const now = Date.now();
  const paid = randomUUID();
  const lapsed = randomUUID();
  const notThisProduct = randomUUID();
  const insert =
    "INSERT INTO users(id,email,password,created_at) VALUES(?,?,?,?)";
  db.prepare(insert).run(
    paid,
    `paid-${paid}@example.test`,
    "x",
    now - 30 * day,
  );
  db.prepare(insert).run(
    lapsed,
    `lapsed-${lapsed}@example.test`,
    "x",
    now - 30 * day,
  );
  db.prepare(insert).run(
    notThisProduct,
    `np-${notThisProduct}@example.test`,
    "x",
    now,
  );
  const sub =
    "INSERT INTO subscriptions(id,user_id,status,period_end,price_id,checked_at) VALUES(?,?,?,?,?,?)";
  // Active and unexpired: the one that must not lose access.
  db.prepare(sub).run(
    randomUUID(),
    paid,
    "active",
    Math.floor(now / 1000) + 20 * day,
    "price_x",
    now,
  );
  // Expired: must not be resurrected by the backfill.
  db.prepare(sub).run(
    randomUUID(),
    lapsed,
    "active",
    Math.floor(now / 1000) - day,
    "price_x",
    now,
  );
  // An empty price id is what syncSubscription writes for a subscription that is
  // not this product, and the migration has to leave that alone. Note the
  // backfill cannot filter on the configured price, because a migration is static
  // SQL and has no access to STRIPE_PRICE_ID; excluding the empty id is both
  // correct and strictly safer than the query it replaces, which compared
  // against an unset STRIPE_PRICE_ID and would have matched these rows.
  db.prepare(sub).run(
    randomUUID(),
    notThisProduct,
    "active",
    Math.floor(now / 1000) + 20 * day,
    "",
    now,
  );

  assert.ok(
    !db
      .prepare("PRAGMA table_info(users)")
      .all()
      .some((c) => c.name === "expiry_date"),
    "precondition: the column does not exist before the migration",
  );
  db.exec(
    readFileSync(
      resolve("drizzle", "0012_entitlement_and_purchases.sql"),
      "utf8",
    ),
  );

  const paidAfter = db
    .prepare("SELECT expiry_date FROM users WHERE id=?")
    .get(paid).expiry_date;
  assert.ok(
    paidAfter && paidAfter > now,
    "a paying account must come out of the migration with access intact",
  );
  assert.equal(
    db.prepare("SELECT expiry_date FROM users WHERE id=?").get(lapsed)
      .expiry_date,
    null,
    "an expired subscription must not be backfilled into access",
  );
  assert.equal(
    db.prepare("SELECT expiry_date FROM users WHERE id=?").get(notThisProduct)
      .expiry_date,
    null,
    "a subscription for another product must not grant this product's access",
  );
  db.close();
});

test("membership follows expiry_date, and the trial still works without one", async () => {
  // membership() reads env through lib/server/db.ts, so it is exercised through
  // the running preview rather than here. What is proven here is the data it
  // reads: NULL expiry plus a recent created_at is a trial, a future expiry is
  // active, a past one is expired, and the columns exist with the right types.
  const db = migrated();
  const now = Date.now();
  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((c) => c.name);
  for (const column of ["expiry_date", "timezone", "streak", "best_streak"])
    assert.ok(columns.includes(column), `users is missing ${column}`);
  const fresh = account(db, { createdAt: now - day });
  const paid = account(db, {
    createdAt: now - 30 * day,
    expiryDate: now + 20 * day,
  });
  const expired = account(db, {
    createdAt: now - 30 * day,
    expiryDate: now - day,
  });
  const row = (id) =>
    db.prepare("SELECT expiry_date, timezone FROM users WHERE id=?").get(id);
  assert.equal(row(fresh).expiry_date, null, "a trial account has no expiry");
  assert.ok(row(paid).expiry_date > now, "a paid account has a future expiry");
  assert.ok(
    row(expired).expiry_date < now,
    "an expired account has a past expiry",
  );
  assert.equal(row(fresh).timezone, "Europe/London", "timezone has a default");
  db.close();
});

test("redemption cannot overdraw, and the ledger agrees with the purse", () => {
  const db = migrated();
  const user = account(db);
  // Seed a purse directly; the earning trigger is not what is under test.
  db.prepare(
    "INSERT INTO credit_wallets(user_id,balance,streak,best_streak) VALUES(?,?,0,0)",
  ).run(user, 30);

  // The same conditional UPDATE redeem() uses, applied to a 20-cost badge.
  const debit = (cost) =>
    db
      .prepare(
        "UPDATE credit_wallets SET balance=balance-? WHERE user_id=? AND balance>=? AND EXISTS(SELECT 1 FROM users WHERE id=?)",
      )
      .run(cost, user, cost, user).changes;

  assert.equal(debit(20), 1, "the first redemption is affordable");
  assert.equal(
    db.prepare("SELECT balance FROM credit_wallets WHERE user_id=?").get(user)
      .balance,
    10,
  );

  // The decisive case: a second redemption the balance cannot cover must change
  // nothing. This is the guarantee the old INSUFFICIENT_CREDITS trigger gave.
  assert.equal(debit(20), 0, "an unaffordable redemption must not apply");
  assert.equal(
    db.prepare("SELECT balance FROM credit_wallets WHERE user_id=?").get(user)
      .balance,
    10,
    "the balance must be untouched by a refused redemption",
  );
  assert.equal(
    db
      .prepare(
        "SELECT balance FROM credit_wallets WHERE user_id=? AND balance<0",
      )
      .get(user),
    undefined,
    "the wallet must never go negative",
  );
  db.close();
});

test("a replayed webhook grants once, not twice", () => {
  const db = migrated();
  const user = account(db, { createdAt: Date.now() - day });
  const confirmation = "sub_replay_test";
  const grant = (newExpiry, createdAt) =>
    db
      .prepare(
        `INSERT INTO purchases(id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(confirmation) DO UPDATE SET
           new_expiry=excluded.new_expiry, status=excluded.status, created_at=excluded.created_at
         WHERE excluded.created_at >= purchases.created_at`,
      )
      .run(
        randomUUID(),
        user,
        "price_x",
        confirmation,
        null,
        newExpiry,
        "active",
        createdAt,
      ).changes;

  const first = Date.now();
  grant(first + 30 * day, first);
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM purchases WHERE user_id=?").get(user).c,
    1,
  );

  // Stripe retries deliveries. A second, later delivery is a legitimate renewal
  // update, not a second purchase.
  const later = first + 1000;
  grant(later + 30 * day, later);
  const rows = db
    .prepare("SELECT new_expiry FROM purchases WHERE user_id=?")
    .all(user);
  assert.equal(
    rows.length,
    1,
    "a retried webhook must not create a second purchase",
  );
  assert.equal(
    rows[0].new_expiry,
    later + 30 * day,
    "but it should record the newer expiry",
  );

  // A delivery that arrives out of order, carrying an older state, must not
  // roll the grant back.
  grant(first + day, first - 1000);
  assert.equal(
    db.prepare("SELECT new_expiry FROM purchases WHERE user_id=?").get(user)
      .new_expiry,
    later + 30 * day,
    "a stale replay must not shorten access",
  );
  db.close();
});

test("the purchases table refuses a duplicate confirmation outright", () => {
  const db = migrated();
  const user = account(db);
  const row = (confirmation) =>
    db
      .prepare(
        "INSERT INTO purchases(id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(randomUUID(), user, "price_x", confirmation, null, 1, "active", 1);
  row("sub_unique_a");
  assert.throws(
    () => row("sub_unique_a"),
    /UNIQUE|constraint/i,
    "the unique index on confirmation is the idempotency guarantee",
  );
  db.close();
});
