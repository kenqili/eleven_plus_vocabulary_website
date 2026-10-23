/**
 * The two time limits in the privacy notice, and the page that carries them out.
 *
 * Nothing deletes an account on a schedule. The promise is kept by an
 * administrator looking at a list - address, when it was made, when it was last
 * used - and pressing Delete. That makes three things worth testing, in order of
 * how badly they go wrong if they are absent:
 *
 *   1. The list is only for the administrator. It contains every address on the
 *      site, so anyone else must not be able to read it.
 *   2. The list is right. An account is due two years after it was last used, and
 *      "used" includes a sign-in that led to nothing; a registration nobody
 *      confirmed is due after a week, unless a link they asked for is still
 *      valid. Getting this backwards deletes a child's record early, deletes an
 *      account between asking for a confirmation and opening it, or keeps an
 *      address blocked for ever.
 *   3. A deletion cannot be aimed at an account that is not due. The server
 *      checks the list again, so a direct call with any other id is refused - the
 *      page is not the boundary.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { signedUp } from "./helpers/account.mjs";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
const skip = local && !process.env.TEST_NODE_DB ? "set TEST_NODE_DB" : !local;
const day = 86_400_000;
const year = 365 * day;

const sql = () => {
  if (!process.env.TEST_NODE_DB)
    throw Error("set TEST_NODE_DB to the local preview SQLite database");
  const db = new DatabaseSync(process.env.TEST_NODE_DB);
  // So the cleanup below takes the rows that hang off an account with it, which
  // is what the server's own delete does.
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return db;
};

async function call(path, body, cookie) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

/** Register without confirming, which is what an abandoned sign-up looks like. */
async function unconfirmed() {
  const db = sql();
  db.prepare("DELETE FROM rate_limits").run();
  const email = `retention-${randomUUID()}@example.test`;
  const result = await call("/api/auth/register", {
    email,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { id: result.body.user.id, email };
}

/** Register, confirm, sign in - then make it the administrator. */
async function administrator() {
  const account = await signedUp("retention-admin");
  sql().prepare("UPDATE users SET is_admin=1 WHERE id=?").run(account.id);
  return account;
}

test(
  "only the administrator can read the list of accounts to delete",
  { skip },
  async () => {
    const db = sql();
    const parent = await signedUp("retention-parent");
    try {
      // The list carries every address on the site, including children's. A
      // 404 rather than a 403: an administrator's page is worth not advertising.
      assert.equal((await call("/api/admin", undefined, parent.cookie)).status, 404);
      assert.equal(
        (await call("/api/admin", { action: "delete-account" }, parent.cookie))
          .status,
        404,
      );
    } finally {
      db.prepare("DELETE FROM users WHERE id=?").run(parent.id);
      db.close();
    }
  },
);

test(
  "the list names the accounts whose time is up, and only those",
  { skip },
  async () => {
    const db = sql();
    const admin = await administrator();
    const stale = await unconfirmed();
    const asked = await unconfirmed();
    const lapsed = await unconfirmed();
    const dormant = await signedUp("retention-dormant");
    const fresh = await signedUp("retention-fresh");
    try {
      // Eight days unconfirmed, and nothing since.
      db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
        Date.now() - 8 * day,
        stale.id,
      );
      // The same age, but a link they asked for is still valid. That is what
      // keeps an account off the list: nobody is deleted between asking for a
      // confirmation and opening it.
      db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
        Date.now() - 8 * day,
        asked.id,
      );
      db.prepare(
        "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE id=?),?,?,?)",
      ).run(
        randomUUID(),
        asked.id,
        randomBytes(32).toString("hex"),
        Date.now() + day,
        Date.now() - 60_000,
      );
      // A link asked for six days ago expired five days ago, and the row may
      // already have been cleared as housekeeping - so the account is due. The
      // rule is an unexpired link, not the memory of one.
      db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
        Date.now() - 8 * day,
        lapsed.id,
      );
      db.prepare(
        "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE id=?),?,?,?)",
      ).run(
        randomUUID(),
        lapsed.id,
        randomBytes(32).toString("hex"),
        Date.now() - 5 * day,
        Date.now() - 6 * day,
      );
      // Confirmed, and nothing has touched it for three years: the account was
      // made, signed into and practised back then, and never since.
      db.prepare("UPDATE users SET created_at=?, last_seen_at=? WHERE id=?").run(
        Date.now() - 3 * year,
        Date.now() - 3 * year,
        dormant.id,
      );

      const list = await call("/api/admin", undefined, admin.cookie);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      const due = list.body.dueAccounts;
      const emails = (rows) => rows.map((row) => row.email);
      assert.ok(emails(due.unconfirmed).includes(stale.email), "stale registration is due");
      assert.ok(emails(due.unconfirmed).includes(lapsed.email), "an expired link does not keep it");
      assert.ok(!emails(due.unconfirmed).includes(asked.email), "an unexpired link keeps it");
      assert.ok(emails(due.dormant).includes(dormant.email), "three years unused is due");
      assert.ok(!emails(due.dormant).includes(fresh.email), "an account used today is not");
      assert.ok(!emails(due.dormant).includes(stale.email), "unconfirmed is not listed twice");
      assert.equal(due.unconfirmed.find((row) => row.email === stale.email).lastUsedAt, null);
      assert.ok(
        Date.now() - due.dormant.find((row) => row.email === dormant.email).lastUsedAt >
          3 * year - day,
        "the date shown is the last sign-in, not today",
      );
    } finally {
      for (const account of [admin, dormant, fresh, stale, asked, lapsed]) {
        db.prepare("DELETE FROM users WHERE id=?").run(account.id);
      }
      db.close();
    }
  },
);

test(
  "deleting is refused unless the account is on the list, and then takes everything",
  { skip },
  async () => {
    const db = sql();
    const admin = await administrator();
    const dormant = await signedUp("retention-delete");
    const fresh = await signedUp("retention-keep");
    try {
      const longAgo = Date.now() - 3 * year;
      db.prepare("UPDATE users SET created_at=?, last_seen_at=? WHERE id=?").run(
        longAgo,
        longAgo,
        dormant.id,
      );
      // Something to prove the cascade with: an answer, its attempt, a badge.
      const attemptId = randomUUID();
      db.prepare(
        "INSERT INTO attempts (id,user_id,word_id,choices,created_at) VALUES(?,?,?,?,?)",
      ).run(attemptId, dormant.id, "word", "[]", longAgo);
      db.prepare(
        "INSERT INTO learning_events (attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(attemptId, dormant.id, "word", longAgo, "2023-10-24", 1, 0, 1, 1);
      db.prepare(
        "INSERT INTO badge_redemptions (id,user_id,request_key,badge_id,badge_name,cost,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(randomUUID(), dormant.id, "k", "b", "Badge", 10, longAgo);

      // An account in use is not on the list, so this is the answer for it - and
      // the same answer an id that never existed gets.
      const refused = await call(
        "/api/admin",
        { action: "delete-account", userId: fresh.id, email: fresh.email },
        admin.cookie,
      );
      assert.equal(refused.status, 404);
      assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(fresh.id));

      // Typing an address that is not the one on the row does not delete it
      // either, which is the mistake two similar rows invite.
      const typo = await call(
        "/api/admin",
        { action: "delete-account", userId: dormant.id, email: fresh.email },
        admin.cookie,
      );
      assert.equal(typo.status, 404);
      assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(dormant.id));

      const done = await call(
        "/api/admin",
        { action: "delete-account", userId: dormant.id, email: dormant.email },
        admin.cookie,
      );
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.removed.records, 1, "the count is what was removed");
      assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(dormant.id), undefined);
      assert.equal(db.prepare("SELECT id FROM attempts WHERE user_id=?").get(dormant.id), undefined);
      assert.equal(
        db.prepare("SELECT attempt_id FROM learning_events WHERE user_id=?").get(dormant.id),
        undefined,
      );
      assert.equal(
        db.prepare("SELECT id FROM badge_redemptions WHERE user_id=?").get(dormant.id),
        undefined,
      );
      // And the list is recomputed, so it is gone from that too.
      const list = await call("/api/admin", undefined, admin.cookie);
      assert.ok(
        !list.body.dueAccounts.dormant.some((row) => row.id === dormant.id),
      );
    } finally {
      for (const account of [admin, fresh]) {
        db.prepare("DELETE FROM users WHERE id=?").run(account.id);
      }
      db.close();
    }
  },
);

test(
  "a parent can still delete their own account",
  { skip },
  async () => {
    // The other way an account goes. It read `password_hash`, a column that does
    // not exist - the column is `password` - so every press of the account page's
    // Delete this account button answered 503 and deleted nothing, which the
    // privacy notice's promise did not cover.
    const db = sql();
    const account = await signedUp("retention-self");
    try {
      const result = await call(
        "/api/auth/delete",
        { password: account.password },
        account.cookie,
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(account.id), undefined);
    } finally {
      db.prepare("DELETE FROM users WHERE id=?").run(account.id);
      db.close();
    }
  },
);

test(
  "signing in is recorded, so an account with no practice is not abandoned",
  { skip },
  async () => {
    // The reason `last_seen_at` exists. A parent who signs in to check their
    // billing and does nothing else left no durable trace: sessions are deleted
    // on sign-out and pruned on expiry, so the list would have judged them on
    // their last answered question and deleted an account in use.
    const db = sql();
    const account = await signedUp("retention-seen");
    try {
      const seen = db
        .prepare("SELECT last_seen_at FROM users WHERE id=?")
        .get(account.id).last_seen_at;
      assert.ok(seen && Date.now() - seen < 60_000, "the sign-in is written down");
    } finally {
      db.prepare("DELETE FROM users WHERE id=?").run(account.id);
      db.close();
    }
  },
);
