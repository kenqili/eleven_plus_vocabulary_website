/**
 * Forgot-password, driven rather than read.
 *
 * tests/password-reset.test.mjs asserts this feature by reading the files, and
 * reading cannot tell you that a link works. The properties that matter most
 * here are only visible when the route is actually run against a database and
 * watched while it happens: that asking for a link says the same thing about an
 * address that has an account and about one that does not, says it a third time
 * when the mail provider is refusing the message, and never puts a working token
 * into a reply. Every one of those is invisible to a source-reading test and
 * silent to a smoke test.
 *
 * Two things stand in for a Worker, and both are already in the repository:
 *
 *   1. The database is scripts/node-dev-db.mjs - the same D1 shim `npm run
 *      dev:node` uses - over a file of its own, so the rows can be read back
 *      between assertions. It is opened once for the whole file and never
 *      closed; see reset().
 *
 *   2. The route is bundled with esbuild at run time, from the one-line entry
 *      in tests/harness/password-reset/. That is where the harness lives: it has
 *      to be committed, because work/ is ignored and a test that depended on it
 *      would break for anyone who had just cloned. esbuild resolves the two
 *      things plain node cannot - the `@/` alias from tsconfig.json, and
 *      `cloudflare:workers`, which becomes the two-line stub beside it - and the
 *      result is imported straight out of memory, so a run leaves no artefact
 *      behind and needs no network.
 *
 * Only the mail provider is faked. globalThis.fetch refuses every URL that is
 * not https://api.resend.com/, which is both how the sent message is recorded
 * and an assertion in itself: if the route ever reached for the network some
 * other way, `elsewhere` would fill up and a test would say so.
 *
 *   node --test tests/password-reset.integration.mjs
 *
 * or `npm run test:password-reset`, which is the same thing and is kept out of
 * the fast `npm test` because this file compiles a route before it can run.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  createHash,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { openLocalDatabase } from "../scripts/node-dev-db.mjs";
import { hashPassword } from "../lib/server/password.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The deployment this file stands in for: https, as in production. */
const APP_ORIGIN = "https://minewords.test";

/**
 * The one account, so "an address nobody has" has something to be different
 * from. The password is a real hash of a real password, because two tests below
 * turn out to depend on the app being able to recognise it.
 */
const USER = { id: "parent-1", email: "parent@example.test" };
const STRANGER = "stranger@example.test";
const OLD_PASSWORD = "Old-Password-One";
const NEW_PASSWORD = "New-Password-Two";

/** The session the reset exists to kill: not the parent's. */
const HIJACKED = "b".repeat(64);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * lib/server/password.ts's own scrypt profile, written out again on purpose.
 *
 * A test that called the module's own verifyPassword would agree with it by
 * construction, and would go on passing if the parameters were ever weakened -
 * which is the one change to that file nobody would notice. So the profile is
 * restated here and the stored hash is checked against it directly. These are the
 * application's numbers, not a stronger set.
 */
const SCRYPT = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const scryptOf = (password, salt) =>
  scryptSync(password, salt, 32, SCRYPT).toString("hex");

/** The route, compiled. See the note at the top of the file about the harness. */
const bundled = await build({
  absWorkingDir: ROOT,
  entryPoints: [join(ROOT, "tests/harness/password-reset/route-entry.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  // In memory: the bundle is the test's own build step, not a committed
  // artefact, and a data: URL needs no temporary file to be imported from.
  write: false,
  external: ["node:*"],
  alias: {
    "@": ROOT,
    "cloudflare:workers": join(
      ROOT,
      "tests/harness/password-reset/workers-env.ts",
    ),
  },
  tsconfig: join(ROOT, "tsconfig.json"),
  logLevel: "warning",
}).then((result) => result.outputFiles[0].text);

/**
 * The database, on a file of its own so the rows can be read back.
 *
 * A caller may point PASSWORD_RESET_TEST_DB at a path to keep the file and look
 * at it afterwards; otherwise it is a temporary one that goes when the run does.
 */
const scratch = process.env.PASSWORD_RESET_TEST_DB
  ? null
  : await mkdtemp(join(tmpdir(), "minewords-password-reset-"));
const database = openLocalDatabase(
  process.env.PASSWORD_RESET_TEST_DB || join(scratch, "d1.sqlite"),
  join(ROOT, "drizzle"),
);
after(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

// The stub reads this once, when the bundle below is evaluated, so it has to be
// in place first.
globalThis.__minewordsHarnessEnv = { DB: database };
const { GET, POST } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled).toString("base64")
);

/** What the provider says to a message it will take. */
const accepts = () =>
  new Response(JSON.stringify({ id: "email_" + randomUUID() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/**
 * What it says to one it will not, quoting the message back the way a real
 * provider does. That echo is the whole reason this fixture exists: a reset
 * message holds the only copy of a working link, so a provider's error body
 * does too, and any code that logged or returned it would publish a live token.
 */
const refuses = (status, note) => (message) =>
  new Response(
    JSON.stringify({
      statusCode: status,
      name: "validation_error",
      message: `${note} ${message.text}`,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );

/** The provider's answer to the next send; replaced per test. */
let provider = accepts;
/** Every message the route has tried to send, in order. */
let sent = [];
/** Every reply the provider has been given, as text, for the echoes. */
let replies = [];
/** Anything the route asked for that is not the provider. Expected to stay empty. */
let elsewhere = [];

globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (!target.startsWith("https://api.resend.com/")) {
    elsewhere.push(target);
    return new Response("{}", { status: 502 });
  }
  const message = JSON.parse(init.body);
  sent.push(message);
  const response = provider(message);
  replies.push({
    status: response.status,
    body: await response.clone().text(),
  });
  return response;
};

/**
 * Empty the database and put the settings back.
 *
 * Every test starts from nothing. A test that inherited a rate-limit counter or
 * a half-spent link from the one before it is testing nothing, and the rate
 * limits are the kind of thing that looks like a bug in whichever test happens to
 * run second.
 *
 * `close()` is never called, deliberately. There is one connection for the whole
 * file, and closing it makes every later query throw "database is not open".
 */
async function reset() {
  // Children first: password_resets and sessions both point at users.
  for (const table of ["password_resets", "rate_limits", "sessions", "users"])
    await database.prepare(`DELETE FROM ${table}`).run();
  sent = [];
  replies = [];
  elsewhere = [];
  provider = accepts;
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "APP_ORIGIN"])
    delete process.env[key];
  // setting() falls back to the process environment for a key the Workers env
  // does not carry, which is how a deployment's configuration reaches the same
  // lib/server/db.ts that reads env.DB above. Two tests delete these on purpose.
  process.env.RESEND_API_KEY = "re_offline_only";
  process.env.EMAIL_FROM = "MineWords <no-reply@minewords.test>";
  process.env.APP_ORIGIN = APP_ORIGIN;
  await database
    .prepare(
      "INSERT INTO users (id,email,password,created_at,rewards_initialized) VALUES (?,?,?,?,0)",
    )
    .bind(USER.id, USER.email, hashPassword(OLD_PASSWORD), Date.now())
    .run();
}

/** A session somebody else is holding, for a reset to end. */
async function seedSession(token = HIJACKED) {
  await database
    .prepare(
      "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
    )
    .bind(sha256(token), USER.id, Date.now() + 604800_000)
    .run();
}

/**
 * The action a request to `path` reaches.
 *
 * `new URL` collapses `..` before anything else looks at a path, which is what a
 * router sees, so the harness cannot disagree with a real framework about what
 * `/api/password-reset/request/../confirm` was addressed to.
 */
const actionAt = (path) =>
  new URL(path, APP_ORIGIN).pathname.split("/").filter(Boolean).at(-1);

/**
 * A POST as the app's own pages send it: to this deployment's origin, with the
 * Origin header a browser attaches. `origin` overrides the header alone, which is
 * what a cross-site request is - the request still arrives at our host. No
 * cf-connecting-ip is sent, so the per-IP limits are all the "local" bucket.
 */
function post(path, payload, { origin = APP_ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return POST(
    new Request(new URL(path, APP_ORIGIN), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ action: actionAt(path) }) },
  );
}

/**
 * The GET a browser makes when it follows an emailed link: no Origin, because a
 * link in a message does not carry one, and that exemption is the reason the
 * check does not demand it.
 */
function check(token) {
  const url = new URL("/api/password-reset/check", APP_ORIGIN);
  if (token !== undefined) url.searchParams.set("token", token);
  return GET(new Request(url));
}

/** A reply, read once: the status, the headers, and the body. */
async function read(response) {
  return {
    status: response.status,
    headers: response.headers,
    cookie: response.headers.get("set-cookie"),
    body: await response.json(),
  };
}

/** The token in the nth most recent message, newest first. */
const tokenFrom = (which = 0) => {
  const text = sent.at(-1 - which)?.text;
  assert.ok(text, `no message was sent ${which + 1} requests ago`);
  const token = /[?&]token=([a-f0-9]{64})/.exec(text)?.[1];
  assert.ok(token, "the message carried no reset link");
  return token;
};

/** Ask for a link, and answer with the token that was actually emailed. */
async function askForLink(email = USER.email) {
  const asked = await read(
    await post("/api/password-reset/request", { email }),
  );
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  return tokenFrom();
}

const storedHash = async () =>
  (
    await database
      .prepare("SELECT password FROM users WHERE id = ?")
      .bind(USER.id)
      .first()
  ).password;
const rows = async (table) =>
  (await database.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first()).c;
const sessionHashes = async () =>
  (
    await database
      .prepare("SELECT token_hash FROM sessions ORDER BY token_hash")
      .all()
  ).results.map((row) => row.token_hash);

test("a parent gets their account back, and nobody else keeps theirs", async () => {
  await reset();
  const before = await storedHash();
  await seedSession();

  const asked = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(sent.length, 1, "asking must send exactly one message");
  assert.equal(sent[0].to, USER.email);
  assert.deepEqual(
    elsewhere,
    [],
    "and must not have reached for anything else",
  );

  const token = tokenFrom();
  // For an hour the emailed token is the password, so the table holds its digest
  // and nothing else: a copy of this file is not a list of working reset links.
  const reset_rows = (
    await database.prepare("SELECT * FROM password_resets").all()
  ).results;
  assert.equal(reset_rows.length, 1, "one link, one row");
  assert.equal(reset_rows[0].user_id, USER.id);
  assert.equal(
    reset_rows[0].token_hash,
    sha256(token),
    "the stored value is the token's sha256",
  );
  assert.notEqual(reset_rows[0].token_hash, token, "and not the token itself");
  assert.equal(
    reset_rows[0].expires_at - reset_rows[0].created_at,
    3_600_000,
    "the row lives for the hour the message promises",
  );

  const looked = await read(await check(token));
  assert.equal(looked.status, 200, JSON.stringify(looked.body));
  assert.deepEqual(
    looked.body,
    { ok: true, email: USER.email },
    "the check tells a holder of the link which account they are on",
  );
  // The URL carries the token, so it must not travel onwards in a Referer or sit
  // in a shared cache.
  assert.equal(looked.headers.get("referrer-policy"), "no-referrer");
  assert.equal(looked.headers.get("cache-control"), "no-store");
  assert.equal(await storedHash(), before, "looking at a link changes nothing");

  const confirmed = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.deepEqual(confirmed.body, { ok: true });
  assert.match(
    confirmed.cookie,
    /__Host-mw_session=[a-f0-9]{64};/,
    "the recovery signs the parent in, rather than making them type the password again",
  );

  const after = await storedHash();
  assert.notEqual(after, before, "the password must actually have changed");
  assert.match(
    after,
    /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/,
    "and be held as a scrypt hash, in the shape lib/server/password.ts writes",
  );
  assert.ok(!after.includes(NEW_PASSWORD), "and never in the clear");
  assert.equal(await rows("password_resets"), 0, "the link is spent");

  // Exactly one session, and it is the new one. The session the password may
  // have been seen through is dead, which is the whole reason a reset is worth
  // doing - and createSession runs after the delete, so the parent is not locked
  // out of the account they just recovered.
  const sessions = await sessionHashes();
  assert.equal(
    sessions.length,
    1,
    `a reset must end every other session; found ${sessions.length} left`,
  );
  assert.notEqual(
    sessions[0],
    sha256(HIJACKED),
    "the pre-existing session is gone",
  );
  // The cookie carries the raw token, the row its digest, so they are compared
  // the way currentUser() compares them.
  assert.equal(
    sha256(/mw_session=([a-f0-9]{64})/.exec(confirmed.cookie)[1]),
    sessions[0],
    "and the one that survived is the session just issued",
  );
});

test("the new password is the one that works, and the old one no longer is", async () => {
  await reset();
  const token = await askForLink();
  const confirmed = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  const stored = await storedHash();
  const [algorithm, salt, digest] = stored.split("$");
  assert.equal(algorithm, "scrypt");
  for (const [what, password, should] of [
    ["the new password", NEW_PASSWORD, true],
    ["the old one", OLD_PASSWORD, false],
  ]) {
    // Compared through the app's own profile, restated at the top of the file.
    const candidate = Buffer.from(scryptOf(password, salt), "hex");
    assert.equal(
      candidate.length,
      32,
      "the digest is 32 bytes, as the profile says",
    );
    assert.equal(
      timingSafeEqual(candidate, Buffer.from(digest, "hex")),
      should,
      `${what} should ${should ? "" : "not "}match the hash that was stored`,
    );
  }
});

test("a link works once and only once", async () => {
  await reset();
  const token = await askForLink();
  const first = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const after = await storedHash();

  const second = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: "Third-Password-Three",
    }),
  );
  assert.equal(second.status, 400, JSON.stringify(second.body));
  assert.match(second.body.error, /expired or has already been used/i);
  assert.equal(await rows("password_resets"), 0, "and the row is not put back");
  assert.equal(
    await storedHash(),
    after,
    "so the second attempt changed nothing",
  );
});

test("an address with no account gets the same answer, and no email", async () => {
  await reset();
  const known = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(known.status, 200, JSON.stringify(known.body));

  const unknown = await read(
    await post("/api/password-reset/request", { email: STRANGER }),
  );
  // The same status and the same body, byte for byte. "Does this address have an
  // account here" is the one question this endpoint exists not to answer, and it
  // is open to anyone.
  assert.equal(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(
    sent.length,
    1,
    "so the second request must not have sent anything",
  );
  assert.equal(
    await rows("password_resets"),
    1,
    "and only the first made a row",
  );
});

test("a provider that refuses the message is not an oracle either", async () => {
  await reset();
  const delivered = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  assert.equal(sent.length, 1);

  // The provider is down, and it can only be down for an address that exists -
  // which is exactly the shape of an oracle. A 503 here would be a list of which
  // families use this site, handed to whoever asks for it.
  await reset();
  provider = refuses(500, "The email service had an internal error.");
  const failed = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(
    failed.status,
    200,
    "a provider that is down must not change the status",
  );
  assert.equal(failed.status, delivered.status);
  assert.deepEqual(failed.body, delivered.body, "or the answer, either");

  await reset();
  provider = refuses(500, "The email service had an internal error.");
  const neverTried = await read(
    await post("/api/password-reset/request", { email: STRANGER }),
  );
  assert.equal(neverTried.status, failed.status);
  assert.deepEqual(
    neverTried.body,
    failed.body,
    "a failure is not a sign of an account",
  );
});

test("an unconfigured provider answers the same way and sends nothing", async () => {
  await reset();
  const configured = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.equal(sent.length, 1);

  // A deployment with no provider set must not be distinguishable either. The
  // send throws before the request is made, and the throw is caught.
  await reset();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  const unconfigured = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(unconfigured.status, configured.status);
  assert.deepEqual(unconfigured.body, configured.body);
  assert.equal(sent.length, 0, "and nothing can have been sent");
  assert.equal(
    await rows("password_resets"),
    1,
    "though the link was still issued, as it is for every address",
  );
});

test("a 422 from the provider never puts the live token in the reply", async () => {
  await reset();
  provider = refuses(422, "The text field failed validation:");
  const asked = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(
    sent.length,
    1,
    "the message was attempted, and the provider saw it all",
  );

  // The provider's own body quotes the message back, so the working link is in
  // it. The fixture is only faithful if that is true of it.
  const token = tokenFrom();
  assert.ok(
    replies[0].body.includes(token),
    "the provider's error body should quote the message, token and all",
  );
  assert.equal(replies[0].status, 422);

  // The reply to the browser, then: the parent is told the same sentence as
  // always, and the only copy of the token stays in the message and the table.
  const said = JSON.stringify(asked.body) + asked.cookie;
  assert.ok(!said.includes(token), `the reply carried the live token: ${said}`);
  assert.ok(
    !said.includes(`${APP_ORIGIN}/reset-password`),
    "or the link that token is in",
  );
});

test("asking again retires the first link", async () => {
  await reset();
  // The newest recorded email each time. Reading the same one twice is how a
  // suite like this passes for the wrong reason and never notices.
  const first = await askForLink();
  const second = await askForLink();
  assert.equal(sent.length, 2, "two requests, two messages");
  assert.notEqual(first, second, "so two links must be two different tokens");
  assert.equal(
    await rows("password_resets"),
    1,
    "and a parent who asked twice has one live link, not two",
  );

  assert.deepEqual(
    (await read(await check(first))).body,
    { ok: false },
    "the older link is retired",
  );
  assert.deepEqual(
    (await read(await check(second))).body,
    { ok: true, email: USER.email },
    "and the newer one is the one that works",
  );
});

test("an expired link is refused at both ends, and changes nothing", async () => {
  await reset();
  await seedSession();
  const before = await storedHash();
  const sessionsBefore = await sessionHashes();
  const token = await askForLink();
  // The hour has passed. The expiry is a condition of the lookup, so this is the
  // same refusal a row that was never live would get.
  await database
    .prepare("UPDATE password_resets SET expires_at = ?")
    .bind(Date.now() - 1)
    .run();

  const looked = await read(await check(token));
  assert.equal(
    looked.status,
    200,
    "a dead link is not an error at the check, it is simply not live",
  );
  assert.deepEqual(looked.body, { ok: false });

  const confirmed = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(confirmed.status, 400, JSON.stringify(confirmed.body));
  assert.equal(
    await storedHash(),
    before,
    "an expired link must not set a password",
  );
  assert.deepEqual(
    await sessionHashes(),
    sessionsBefore,
    "or end a session, which is a change of its own",
  );
  assert.equal(
    await rows("password_resets"),
    1,
    "and the row is left as it was found",
  );
});

test("a token that was never issued is refused, never a 500", async () => {
  await reset();
  // Captured before, because the fixture hash has a random salt in it and can
  // only ever be compared with itself.
  const before = await storedHash();
  const guesses = [
    "",
    "nonsense",
    "z".repeat(64),
    "a".repeat(63),
    "A".repeat(64),
    "../../etc/passwd",
    "0".repeat(64),
  ];
  for (const guess of guesses) {
    // A link in a URL is the least trustworthy thing on the reset page, so all of
    // these have to be ordinary answers rather than failures: 200 with ok:false
    // at the check, 400 at the confirm, and never the 503 a boundary() would
    // turn an unexpected error into.
    const looked = await read(await check(guess));
    assert.equal(
      looked.status,
      200,
      `checking ${JSON.stringify(guess)} should be 200, got ${looked.status}`,
    );
    assert.deepEqual(
      looked.body,
      { ok: false },
      `the check should say no to ${JSON.stringify(guess)}`,
    );
    const confirmed = await read(
      await post("/api/password-reset/confirm", {
        token: guess,
        password: NEW_PASSWORD,
      }),
    );
    assert.equal(
      confirmed.status,
      400,
      `confirming ${JSON.stringify(guess)} should be 400, got ${confirmed.status}`,
    );
    assert.ok(confirmed.body.error, "and say what to do about it");
  }
  assert.equal(await rows("password_resets"), 0);
  assert.equal(await storedHash(), before, "and no guess set a password");
});

test("a POST from another site is refused by both actions", async () => {
  await reset();
  for (const path of [
    "/api/password-reset/request",
    "/api/password-reset/confirm",
  ]) {
    const reply = await read(
      await post(
        path,
        { email: USER.email, token: "0".repeat(64), password: NEW_PASSWORD },
        { origin: "https://elsewhere.example" },
      ),
    );
    // The request still arrives at this host; only the Origin is not ours. So
    // the check has to be here, and has to be before the action runs.
    assert.equal(
      reply.status,
      403,
      `${path} answered a cross-site POST with ${reply.status}`,
    );
    assert.match(reply.body.error, /from MineWords/);
  }
  assert.equal(sent.length, 0, "and nothing was sent");
  assert.equal(await rows("password_resets"), 0, "and no link was issued");
  assert.equal(
    await rows("rate_limits"),
    0,
    "nor was a request counted against anybody",
  );
});

test("asking over and over is rate limited per address", async () => {
  await reset();
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt++)
    statuses.push(
      (
        await read(
          await post("/api/password-reset/request", { email: USER.email }),
        )
      ).status,
    );
  assert.ok(
    statuses.includes(429),
    `six requests to one address should be throttled; got ${statuses.join(", ")}`,
  );

  // The address is what is counted, so a different one is untouched. Seven
  // requests are also well under the per-IP limit, which is what makes this a
  // statement about the address and not about the connection.
  const other = await read(
    await post("/api/password-reset/request", { email: STRANGER }),
  );
  assert.equal(
    other.status,
    200,
    `a different address should be served; got ${other.status}`,
  );
});

test("guessing at one token does not lock out a different, live one", async () => {
  await reset();
  const retired = await askForLink();
  // Asking again retires the first, so the token being hammered is a dead one -
  // which is what an attacker guessing from a leaked list actually holds.
  const live = await askForLink();
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt++)
    statuses.push(
      (
        await read(
          await post("/api/password-reset/confirm", {
            token: retired,
            password: NEW_PASSWORD,
          }),
        )
      ).status,
    );
  assert.ok(
    statuses.includes(429),
    `a sixth attempt at one token should be throttled; got ${statuses.join(", ")}`,
  );
  assert.equal(
    await rows("password_resets"),
    1,
    "and none of it reached the table",
  );

  // The token is the unit of this limit, so a real link held by the same caller
  // is still usable - and the per-IP limit has room left for it.
  const confirmed = await read(
    await post("/api/password-reset/confirm", {
      token: live,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(
    await rows("password_resets"),
    0,
    "so the legitimate link still worked",
  );
});

test("cycling confirmations from one address is throttled, and sets no password", async () => {
  await reset();
  const before = await storedHash();
  const statuses = [];
  for (let attempt = 0; attempt < 12; attempt++)
    statuses.push(
      (
        await read(
          await post("/api/password-reset/confirm", {
            token: sha256(randomUUID()),
            password: NEW_PASSWORD,
          }),
        )
      ).status,
    );
  // Twelve distinct tokens nobody was ever issued, from one address.
  assert.ok(
    statuses.includes(429),
    `that should be throttled before the end; got ${statuses.join(", ")}`,
  );
  assert.equal(
    await storedHash(),
    before,
    "and not one of them set a password",
  );
  assert.equal(await rows("sessions"), 0, "nor signed anybody in");
});

test("an address that is not an address is refused before anything happens", async () => {
  await reset();
  for (const payload of [
    { email: "not-an-email" },
    { email: "" },
    { email: "   " },
    {},
  ]) {
    const reply = await read(
      await post("/api/password-reset/request", payload),
    );
    assert.equal(
      reply.status,
      400,
      `${JSON.stringify(payload)} should be refused, got ${reply.status}`,
    );
    assert.match(reply.body.error, /valid email address/i);
  }
  assert.equal(sent.length, 0, "nothing was sent");
  assert.equal(await rows("password_resets"), 0, "and no link was issued");
});

test("a password that is too short is refused, and the link survives", async () => {
  await reset();
  const before = await storedHash();
  const token = await askForLink();
  const refused = await read(
    await post("/api/password-reset/confirm", { token, password: "short" }),
  );
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(
    refused.body.error,
    /8 to 128/,
    "the parent is told what the rule is",
  );

  // The rule is checked before the link is spent, so a parent who mistyped it
  // can type it again rather than wait for another email - and asking again
  // would retire this one, so the difference matters.
  assert.equal(
    await rows("password_resets"),
    1,
    "the link must still be in the table",
  );
  assert.deepEqual(
    (await read(await check(token))).body,
    { ok: true, email: USER.email },
    "and still be live",
  );
  assert.equal(await storedHash(), before, "with nothing changed");

  const retried = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
});

test("a new password identical to the old one is refused", async () => {
  await reset();
  const before = await storedHash();
  const token = await askForLink();
  const refused = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: OLD_PASSWORD,
    }),
  );
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  // Not a security measure, and said so in the route: this is a parent who
  // believed they had recovered the account and did not.
  assert.match(refused.body.error, /matches the old one/i);
  assert.equal(await storedHash(), before, "and nothing was changed");
  assert.equal(
    await rows("password_resets"),
    1,
    "the link is still there to use properly",
  );
});

test("no session is needed to use a link, which is the point of one", async () => {
  await reset();
  const token = await askForLink();
  // No Cookie header at all: what a parent who is locked out and following a
  // message in their own mailbox has. Every other route that changes a password
  // would answer 401 to this.
  const confirmed = await read(
    await post("/api/password-reset/confirm", {
      token,
      password: NEW_PASSWORD,
    }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.ok(confirmed.cookie, "and the link leaves them signed in");
  assert.equal(
    await rows("password_resets"),
    0,
    "having been spent, like any other",
  );
});

test("an unknown action is a 404, a traversal reaches confirm, and a GET sends nothing", async () => {
  await reset();
  const unknown = await read(
    await post("/api/password-reset/retire", { email: USER.email }),
  );
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
  assert.equal(sent.length, 0, "and an action nobody knows asked for nothing");

  // A framework collapses `..` in the path before it reads the dynamic segment,
  // and so does this harness, so the two cannot disagree about what the request
  // was addressed to.
  const traversal = "/api/password-reset/request/../confirm";
  assert.equal(
    new URL(traversal, APP_ORIGIN).pathname,
    "/api/password-reset/confirm",
    "the harness must normalise a traversal path the way a router does",
  );
  assert.equal(actionAt(traversal), "confirm");
  const token = await askForLink();
  const confirmed = await read(
    await post(traversal, { token, password: NEW_PASSWORD }),
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(
    await rows("password_resets"),
    0,
    "so it really was the confirm action",
  );

  // The GET is the one exemption from the origin check, and it earns it by writing
  // nothing: opened on the POST-only action it is still a read, and it sends no
  // mail.
  const got = await read(await check(undefined));
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.deepEqual(got.body, { ok: false });
  assert.equal(
    sent.length,
    1,
    "and the one message is still the only one sent",
  );
});

test("the emailed link is built from the configured APP_ORIGIN", async () => {
  await reset();
  // A different host from the one the rest of the file uses, because a
  // hard-coded one would pass every other test in here.
  const origin = "https://minewords.example";
  process.env.APP_ORIGIN = origin;
  const asked = await read(
    await post("/api/password-reset/request", { email: USER.email }),
  );
  assert.equal(asked.status, 200, JSON.stringify(asked.body));

  const token = tokenFrom();
  assert.ok(
    sent[0].text.includes(`${origin}/reset-password?token=${token}`),
    `the link should be ${origin}/reset-password?token=..., and the message says: ${sent[0].text}`,
  );
  assert.ok(
    !sent[0].text.includes("minewords.test/reset-password"),
    "and must not point at any other host",
  );
  // Which is the same link, so it is the live one: a hard-coded host would have
  // produced a message this assertion cannot pass.
  assert.deepEqual((await read(await check(token))).body, {
    ok: true,
    email: USER.email,
  });
});
