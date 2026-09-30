/**
 * The link in the confirmation email has to open a page.
 *
 * Registering stopped handing out a session, so the emailed link is the only way
 * into a new account - and for a while the path the email built was served by
 * nothing at all. The parent clicked the link they had just been sent and got a
 * 404, and could not sign in either, because sign-in refuses an unconfirmed
 * address. Every account created since was locked out, and no symptom said why.
 *
 * The other suite covers the rules the link obeys: single use, expiry, and no
 * account before the confirmation. None of that is what went wrong. What went
 * wrong is that the URL a parent is sent had no page behind it, and every one of
 * those tests fetched `/api/confirm-email` directly - the API, which worked. So
 * the tests below fetch the *emailed* URL, from the constant the email is built
 * from, and require a page to come back.
 *
 * The token is planted rather than extracted, for the reason
 * email-verification.integration.mjs gives: `emailReady()` is false in the test
 * environment, so nothing is ever sent and there is no message to read. What is
 * planted is a row with a known plaintext token, which is what the link in a
 * real message resolves to. The path is not hard-coded here, because a test that
 * pinned it would keep passing while the email pointed somewhere else - which is
 * the bug itself.
 *
 *   node --test tests/confirm-email.integration.mjs
 *
 * or TEST_ORIGIN=... TEST_NODE_DB=.sites-runtime/node-dev.sqlite with a dev
 * server running; without those it skips, as the other suite does.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
const skip = local && !process.env.TEST_NODE_DB ? "set TEST_NODE_DB" : !local;

/**
 * The deployment's APP_ORIGIN, normalised the way deliverVerification
 * normalises it with `new URL(origin).origin`. It is the server under test and
 * not whatever this machine has configured, because a test that fetched a
 * deployment's own host would be testing somebody else's site.
 */
const APP_ORIGIN = new URL(origin).origin;

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
  const address = email || `confirm-${randomUUID()}@example.test`;
  const result = await call("/api/auth/register", {
    email: address,
    password: `Test-only-${randomUUID()}`,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { address, result };
}

const cleanup = (db, email) =>
  db.prepare("DELETE FROM users WHERE email=?").run(email);

/** The shape a token has, and the only shape worth a lookup. */
const freshToken = () =>
  randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");

/** A live link for an account, as the email would have left one. */
function plant(db, email, token, expiresAt) {
  db.prepare(
    "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES(?,(SELECT id FROM users WHERE email=?),?,?,?)",
  ).run(randomUUID(), email, digest(token), expiresAt, Date.now());
}

/**
 * The path the email puts in its link, read out of the file that builds it.
 *
 * Read rather than written down, because the whole failure was a path and a
 * handler disagreeing: a test carrying its own copy of "/confirm-email" agrees
 * with the email even when the email has moved.
 */
const emailedPath = () => {
  const source = readFileSync("lib/server/email-verification.ts", "utf8");
  const found = /VERIFY_LINK_PATH\s*=\s*"([^"]+)"/.exec(source);
  assert.ok(
    found,
    "VERIFY_LINK_PATH is the constant the link is built from and must stay one",
  );
  return found[1];
};

/** The URL a parent reads in the message, built the way the email builds it. */
const emailedLink = (token) => `${APP_ORIGIN}${emailedPath()}?token=${token}`;

test("the link in the email opens a page", { skip }, async () => {
  const db = sql();
  const { address } = await register();
  const token = freshToken();
  try {
    plant(db, address, token, Date.now() + 86_400_000);
    const link = emailedLink(token);
    assert.equal(
      link,
      `${APP_ORIGIN}/confirm-email?token=${token}`,
      `the emailed link has to be a page of this app, and ${link} is not one. A parent who follows it has to land somewhere.`,
    );

    const page = await fetch(link);
    const html = await page.text();
    assert.equal(
      page.status,
      200,
      `the link a parent is sent must answer. ${link} answered ${page.status}: an emailed link with no page behind it is a dead account, and the 404 says nothing about why.`,
    );
    assert.match(
      html,
      /confirm your email address/i,
      "the page has to be the confirmation screen, not something that happens to answer 200",
    );
    // The state the page draws before the token is spent, which is how the client
    // component is known to be on this page at all rather than in a shell.
    assert.match(
      html,
      /checking your link/i,
      "the confirmation screen has to be the thing that renders here",
    );

    // And a visit with nothing in the URL is still that page. A mail client that
    // strips the query must not produce a 404 either.
    const bare = await fetch(`${APP_ORIGIN}/confirm-email`);
    assert.equal(
      bare.status,
      200,
      "a link that has lost its code still has to land on the page that explains it",
    );
  } finally {
    cleanup(db, address);
    db.close();
  }
});

test("the link in the email opens the account, once", { skip }, async () => {
  const db = sql();
  const { address } = await register();
  const token = freshToken();
  try {
    plant(db, address, token, Date.now() + 86_400_000);

    // Opening the page spends nothing: the server draws the screen and the
    // browser is what calls the API. If rendering confirmed the account, the
    // single-use property below would be an accident of ordering.
    const link = emailedLink(token);
    const page = await fetch(link);
    assert.equal(
      page.status,
      200,
      `the emailed link must answer: ${link} returned ${page.status}`,
    );
    assert.equal(
      db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address).email_verified_at,
      null,
      "drawing the page must not confirm anything on its own",
    );

    // What that page then does with the token it was given.
    const confirm = await fetch(
      `${APP_ORIGIN}/api/confirm-email?token=${token}`,
    );
    assert.equal(confirm.status, 200, await confirm.text());
    assert.ok(
      (confirm.headers.get("set-cookie") || "").length > 0,
      "the parent has just proved the address, so they should not have to type the password again",
    );
    assert.equal(
      confirm.headers.get("referrer-policy"),
      "no-referrer",
      "this URL carries a single-use token, and a link out of the page must not carry it in a Referer header",
    );
    assert.equal(
      db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(address).email_verified_at !== null,
      true,
      "and the account is now confirmed",
    );

    // The link is spent, whichever URL spent it. A forwarded or prefetched link
    // has to stop working, and a parent who reloads must not be able to spend it
    // a second time either.
    const again = await fetch(`${APP_ORIGIN}/api/confirm-email?token=${token}`);
    assert.equal(again.status, 400, "a single-use link must not work twice");
  } finally {
    cleanup(db, address);
    db.close();
  }
});

test("the page spends the token from its own URL", () => {
  // The only part of the journey no request can observe: the page above answers
  // 200 whatever the token, because confirming is the browser's call. A page that
  // renders and never asks would pass both tests above and lock out every parent
  // exactly as thoroughly as the 404 did, so the wiring is read here instead.
  const page = readFileSync("components/minewords/confirm-email.tsx", "utf8");
  assert.match(
    page,
    /new URLSearchParams\(window\.location\.search\)\.get\("token"\)/,
    "the token has to come from this page's URL, read where window exists",
  );
  assert.match(
    page,
    /\/api\/confirm-email\?token=/,
    "and it has to be spent against the API that confirms the address",
  );
});
