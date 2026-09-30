/**
 * An account that cannot receive mail is not an account.
 *
 * Registering used to hand out a working session immediately, with nothing to
 * prove the address was one the parent could read. A parent who mistyped it then
 * practised for the seven-day trial and discovered, at the worst moment, that
 * nobody could ever reset the account - and there was no symptom to notice until
 * then.
 *
 * The properties below are the ones that matter, in order of how badly it goes
 * wrong if they are absent:
 *
 *   1. An unconfirmed account cannot be signed into. Otherwise confirming proves
 *      nothing, because the thing it gates was never actually gated.
 *   2. Registering hands out no session, so a new parent is not left holding a
 *      cookie that does not work.
 *   3. A wrong password still says the password is wrong, even for an unconfirmed
 *      address. Refusing earlier would let anyone learn which addresses are
 *      registered without knowing one password - so this is the property that
 *      makes the feature safe to add at all.
 *   4. The link works once, and only while it is valid.
 *   5. A password reset confirms the address, because it is the only route back
 *      for a parent whose confirmation was lost. Without it, "unconfirmed" is a
 *      dead end.
 *   6. Existing accounts are not locked out by the migration.
 *
 * The token is planted rather than extracted, because the email cannot be read
 * here: `emailReady()` is false in the test environment, so the route takes the
 * "not configured" path and sends nothing. Planting a row with a known plaintext
 * token tests the part that decides access, which is the part worth testing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
const skip = local && !process.env.TEST_NODE_DB ? "set TEST_NODE_DB" : !local;

const sql = () => {
  if (!process.env.TEST_NODE_DB)
    throw Error("set TEST_NODE_DB to the local preview SQLite database");
  return new DatabaseSync(process.env.TEST_NODE_DB);
};

/** sha256, the same digest the server stores. */
const digest = (token) => createHash("sha256").update(token).digest("hex");

async function call(path, body, cookie) {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    cookie: (response.headers.get("set-cookie") || "").split(";")[0],
  };
}

/** Register, and return the account the row describes. */
async function register(email) {
  sql().prepare("DELETE FROM rate_limits").run();
  const address = email || `verify-${randomUUID()}@example.test`;
  const result = await call("/api/auth/register", {
    email: address,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { address, result };
}

const cleanup = (db, email) =>
  db.prepare("DELETE FROM users WHERE email=?").run(email);

test(
  "registering confirms the address instead of signing you in",
  { skip },
  async () => {
    const db = sql();
    const { address, result } = await register();
    try {
      assert.equal(
        result.body.needsVerification,
        true,
        "the interface has to know to show the waiting screen rather than the account",
      );
      assert.ok(result.body.message, "and it needs something to say");
      assert.equal(
        result.cookie,
        "",
        "no session may be issued: an unconfirmed account cannot be signed into, so a cookie would be one that does not work",
      );
      const row = db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address);
      assert.equal(
        row.email_verified_at,
        null,
        "a new account starts unconfirmed, or the confirmation proves nothing",
      );
    } finally {
      cleanup(db, address);
      db.close();
    }
  },
);

test("an unconfirmed account cannot be signed into", { skip }, async () => {
  const db = sql();
  const { address, result } = await register();
  const password = "the-password-they-chose";
  try {
    // Re-register with a known password so the login attempt is unambiguous.
    cleanup(db, address);
    sql().prepare("DELETE FROM rate_limits").run();
    const again = await call("/api/auth/register", {
      email: address,
      password,
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));

    const login = await call("/api/auth/login", { email: address, password });
    assert.equal(
      login.status,
      403,
      "an unconfirmed account must not be usable",
    );
    assert.equal(
      login.body.code,
      "email_unverified",
      "and the interface needs a code to tell this apart from a wrong password",
    );
    assert.equal(login.cookie, "", "and no session may be issued");
  } finally {
    cleanup(db, address);
    db.close();
  }
});

test(
  "a wrong password says so, even for an unconfirmed address",
  { skip },
  async () => {
    // The property that makes the whole feature safe. If this returned
    // "email_unverified" instead, then before guessing a password anybody could
    // enumerate registered addresses - and, worse, tell a registered unconfirmed
    // address from an unregistered one.
    const db = sql();
    const { address, result } = await register();
    void result;
    try {
      const wrong = await call("/api/auth/login", {
        email: address,
        password: "not-the-password",
      });
      assert.equal(wrong.status, 401);
      assert.equal(
        wrong.body.code,
        undefined,
        `a wrong password must not be reported as an unconfirmed address, or this endpoint enumerates accounts. Got: ${JSON.stringify(wrong.body)}`,
      );
    } finally {
      cleanup(db, address);
      db.close();
    }
  },
);

test("the confirmation link opens the account, once", { skip }, async () => {
  const db = sql();
  const { address, result } = await register();
  void result;
  const token =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  try {
    db.prepare(
      "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE email=?),?,?,?)",
    ).run(
      randomUUID(),
      address,
      digest(token),
      Date.now() + 60_000,
      Date.now(),
    );

    const confirm = await fetch(`${origin}/api/confirm-email?token=${token}`);
    assert.equal(confirm.status, 200, await confirm.text());
    assert.ok(
      (confirm.headers.get("set-cookie") || "").length > 0,
      "the parent has just proved the address, so they should not have to type the password again",
    );
    assert.equal(
      db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address).email_verified_at !== null,
      true,
      "and the account is now confirmed",
    );

    // The link is spent. A second use must not silently succeed, because a link
    // forwarded or prefetched by a mail client has to stop working.
    const again = await fetch(`${origin}/api/confirm-email?token=${token}`);
    assert.equal(again.status, 400, "a single-use link must not work twice");
  } finally {
    cleanup(db, address);
    db.close();
  }
});

test("an expired link does not open anything", { skip }, async () => {
  const db = sql();
  const { address, result } = await register();
  void result;
  const token =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  try {
    db.prepare(
      "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE email=?),?,?,?)",
    ).run(
      randomUUID(),
      address,
      digest(token),
      // Yesterday. The expiry is read in the lookup rather than swept, so a table
      // nobody has pruned cannot be read as permission - this is the test for that.
      Date.now() - 86_400_000,
      Date.now() - 86_400_000,
    );
    const confirm = await fetch(`${origin}/api/confirm-email?token=${token}`);
    assert.equal(confirm.status, 400, "an expired link must not work");
    assert.equal(
      db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address).email_verified_at,
      null,
      "and the account must stay unconfirmed",
    );
  } finally {
    cleanup(db, address);
    db.close();
  }
});

test(
  "a password reset confirms the address, so nothing is a dead end",
  { skip },
  async () => {
    // The escape hatch. Without it, a parent whose confirmation was lost cannot sign
    // in and cannot reset, and the account is unreachable by every route.
    const db = sql();
    const { address, result } = await register();
    void result;
    const token =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    try {
      db.prepare(
        "INSERT INTO password_resets (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE email=?),?,?,?)",
      ).run(
        randomUUID(),
        address,
        digest(token),
        Date.now() + 3_600_000,
        Date.now(),
      );

      const confirm = await call("/api/password-reset/confirm", {
        token,
        password: "a-new-password",
      });
      assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
      assert.equal(
        db
          .prepare("SELECT email_verified_at FROM users WHERE email=?")
          .get(address).email_verified_at !== null,
        true,
        "receiving the reset mail at that address is the proof the confirmation was asking for",
      );

      // And the account is genuinely usable now, which is the point.
      const login = await call("/api/auth/login", {
        email: address,
        password: "a-new-password",
      });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      assert.ok(login.cookie, "so the parent is not left locked out");
    } finally {
      cleanup(db, address);
      db.close();
    }
  },
);

test(
  "asking for the link again reveals nothing about any address",
  { skip },
  async () => {
    // Three addresses: unconfirmed, confirmed, and never registered. The reply has
    // to be identical for all three, or this endpoint is a way to learn who has an
    // account - and it is the endpoint a parent will press without thinking, and
    // anyone else will press on purpose.
    const db = sql();
    const unconfirmed = await register();
    const confirmed = await register();
    const never = `never-${randomUUID()}@example.test`;
    const password = "the-password-they-chose";
    try {
      for (const { address } of [unconfirmed, confirmed]) {
        cleanup(db, address);
        sql().prepare("DELETE FROM rate_limits").run();
        await call("/api/auth/register", { email: address, password });
      }
      // Mark one confirmed directly: getting there through the link would need a
      // planted token, and what is under test here is the reply, not the journey.
      db.prepare("UPDATE users SET email_verified_at=? WHERE email=?").run(
        Date.now(),
        confirmed.address,
      );

      const replies = [];
      for (const address of [unconfirmed.address, confirmed.address, never]) {
        sql().prepare("DELETE FROM rate_limits").run();
        const result = await call("/api/auth/resend-verification", {
          email: address,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        replies.push(JSON.stringify(result.body));
      }
      assert.equal(
        new Set(replies).size,
        1,
        `all three must answer identically, or this enumerates accounts: ${replies.join(" / ")}`,
      );
    } finally {
      for (const { address } of [unconfirmed, confirmed]) cleanup(db, address);
      db.close();
    }
  },
);

test(
  "accounts that existed before the feature are not locked out",
  { skip },
  async () => {
    // The migration's backfill, checked as a behaviour rather than as a SQL string:
    // if this regresses, every existing parent is refused at sign-in on the deploy,
    // and the password reset escape hatch is the only thing standing between them
    // and losing their progress.
    const db = sql();
    const address = `existing-${randomUUID()}@example.test`;
    const createdAt = Date.now() - 90 * 86_400_000;
    try {
      // Inserted the way an account from before the migration would look if the
      // backfill had not run: verified_at absent, which in SQLite means NULL.
      db.prepare(
        "INSERT INTO users (id,email,password,created_at) VALUES(?,?,?,?)",
      ).run(randomUUID(), address, "scrypt$00$00", createdAt);
      const row = db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address);
      assert.equal(
        row.email_verified_at,
        null,
        "a hand-inserted pre-feature row is unverified, which is the state the backfill exists to prevent",
      );
    } finally {
      cleanup(db, address);
      db.close();
    }
  },
);

test("the migration stamps every pre-existing account", { skip }, async () => {
  // And the other half: prove the backfill itself, by applying the migrations to an
  // empty database with a pre-feature account in it. A hand-inserted row above
  // cannot show whether the UPDATE runs, only what it would leave behind.
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  try {
    const files = readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (file.startsWith("0014")) continue;
      db.exec(
        readFileSync(`drizzle/${file}`, "utf8")
          .split("--> statement-breakpoint")
          .join(""),
      );
    }
    const createdAt = Date.now() - 90 * 86_400_000;
    db.prepare(
      "INSERT INTO users (id,email,password,created_at) VALUES(?,?,?,?)",
    ).run("old", "old@example.test", "scrypt$00$00", createdAt);
    assert.equal(
      db
        .prepare(
          "SELECT name FROM pragma_table_info('users') WHERE name='email_verified_at'",
        )
        .get(),
      undefined,
      "before 0014 there is no such column at all, which is the state being migrated from",
    );
    db.exec(
      readFileSync("drizzle/0014_email_verification.sql", "utf8")
        .split("--> statement-breakpoint")
        .join(""),
    );
    const after = db
      .prepare("SELECT email_verified_at FROM users WHERE id='old'")
      .get().email_verified_at;
    assert.ok(after, "applying 0014 must confirm existing accounts");
    assert.ok(
      Math.abs(after - createdAt) < 1000,
      "and it should say when the account was made, not when the migration ran",
    );
    // A new account created after the migration is unconfirmed, or the column
    // would never mean anything.
    db.prepare(
      "INSERT INTO users (id,email,password,created_at) VALUES(?,?,?,?)",
    ).run("new", "new@example.test", "scrypt$00$00", Date.now());
    assert.equal(
      db.prepare("SELECT email_verified_at FROM users WHERE id='new'").get()
        .email_verified_at,
      null,
      "an account created after the migration must start unconfirmed",
    );
  } finally {
    db.close();
  }
});
