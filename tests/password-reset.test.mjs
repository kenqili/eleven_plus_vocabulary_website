// Forgot-password, read as source rather than run as code.
//
// A reset is the one door into an account that does not need the password, and
// the one door a parent can reach at three in the morning when nobody else is
// awake to help. Everything below is asserted against the file rather than
// driven through the app: the flow needs a database, a Worker runtime and a
// mail provider, and a test that needs all three is a test nobody runs before
// the change that breaks it.
//
// The properties are the ones whose absence is silent. A link that is never
// stored hashed still works, so nothing appears broken. A token that lives a
// week still works. A 503 that only ever appears for addresses somebody has is
// a list of which families use this site, delivered to whoever asks. None of
// those fail a smoke test and all of them are the reason this file exists.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTE = "app/api/password-reset/[action]/route.ts";
const route = read(ROUTE);
const reset = read("lib/server/password-reset.ts");
const email = read("lib/server/email.ts");
const page = read("components/minewords/reset-password.tsx");
const account = read("components/minewords/account.tsx");
const migration = read("drizzle/0013_password_reset.sql");

/** The source of one function, from its declaration to whatever follows it. */
function between(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) return "";
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to < 0 ? source.length : to);
}

/** The same source with its `//` prose removed. Newlines are kept. */
function withoutComments(source) {
  return source.replace(/\/\/[^\n]*/g, "");
}

test("the emailed token is never written down", () => {
  // For an hour the token is the password, and it arrives in a mailbox. If the
  // raw value sat in D1 then a copy of the database - a backup, a support
  // export, a read-only console login - would be a list of working reset links.
  // This is the same reason session tokens are stored as digests.
  const from = reset.indexOf("INSERT INTO password_resets");
  assert.ok(from > 0, "nothing inserts a reset row, so no link can ever work");
  const insert = between(
    reset.slice(from),
    "INSERT INTO password_resets",
    "return token;",
  );
  assert.match(
    insert,
    /INSERT INTO password_resets \(id,user_id,token_hash,expires_at,created_at\) VALUES \(\?,\?,\?,\?,\?\)/,
    "the insert has changed shape, so check what goes in the token column",
  );
  assert.match(
    insert,
    /tokenDigest\(token\)/,
    "the token reaches the table un-hashed",
  );
  // Everything else bound into that row is an id, a time and the digest. A bare
  // token as a sixth value would be the one that matters and the one nobody
  // would look at twice in a diff.
  assert.ok(
    !/\btoken\b/.test(insert.replace(/tokenDigest\(token\)/g, "")),
    "the raw token is bound into the reset row alongside the digest",
  );
  // And the column is named for what is actually in it, so nobody later reads
  // token_hash expecting to find a token.
  assert.match(
    migration,
    /\btoken_hash TEXT NOT NULL/,
    "the stored column is not named token_hash, so it may not be a digest",
  );
});

test("a reset link lasts one hour, and expiry is the lookup's own condition", () => {
  // A day would be a convenience nobody asked for. A week is what a forgotten
  // link in a mailbox from last Christmas is, and that is the copy nobody is
  // watching. The number is compared exactly so widening it has to be deliberate.
  const expression = reset.match(/RESET_TTL_MS = ([^;]+);/)?.[1];
  assert.ok(expression, "there is no lifetime on a reset link at all");
  // The source writes it as arithmetic, so it is evaluated rather than matched
  // as text: `60 * 60 * 1000` and `3600000` are the same promise, and only one
  // of them would match a string comparison.
  const ttl = expression
    .split("*")
    .map((part) => Number(part.trim()))
    .reduce((total, part) => total * part, 1);
  assert.equal(ttl, 3_600_000, `a reset link lives for ${ttl}ms, not an hour`);
  // Expiry in the query rather than in the caller, so a dead row cannot be read
  // as permission by any future caller that forgets to check it. A sweeper is
  // an optimisation; it is not the thing that makes a link stop working.
  assert.match(
    between(reset, "export async function findLiveReset"),
    /expires_at > \?/,
    "the lookup does not filter on expires_at, so a dead link still resolves",
  );
});

test("a reset link is spent the moment it is used", () => {
  // Single use is what makes the emailed copy of the token disposable: the one
  // thing a parent or an attacker can do with a link they did not ask for is
  // use it, and then it is gone. Deleted by the row's own id, not by a blanket
  // sweep, so a second row cannot be what gets deleted.
  const confirm = between(route, "async function confirmReset");
  assert.match(
    confirm,
    /DELETE FROM password_resets WHERE id = \?/,
    "the reset row is not deleted, so one link can set a password twice",
  );
  assert.match(
    confirm,
    /\.bind\(reset\.id\)/,
    "the delete is not bound to the row that was just spent",
  );
});

test("a reset ends every session, which is the whole point of one", () => {
  // The reason a parent reaches for this is that the password may have been
  // seen. Changing the password while leaving somebody else's session alive has
  // fixed nothing: it has only told the person in the account to sign in again,
  // and given whoever was in it a warning that they have now been removed.
  const confirm = between(route, "async function confirmReset");
  assert.match(
    confirm,
    /DELETE FROM sessions WHERE user_id = \?/,
    "a reset must delete every session on the account, not just make a new one",
  );
  // And the new session is issued after that delete, or it would delete itself
  // and lock the parent out of the account they just recovered.
  assert.ok(
    confirm.indexOf("createSession") > confirm.indexOf("DELETE FROM sessions"),
    "the new session is created inside the delete, so the parent is signed out by their own recovery",
  );
});

test("the new password is hashed on the way in and is never itself bound", () => {
  // The column is called password and must only ever receive a hash. A reset
  // that stored the plaintext would be worse than the bug it fixes: a parent
  // who has lost their old password would be handing it back to us in clear.
  const confirm = between(route, "async function confirmReset");
  assert.match(
    confirm,
    /UPDATE users SET password = \? WHERE id = \?/,
    "the update against the user row has changed shape",
  );
  assert.match(
    confirm,
    /\.bind\(hashPassword\(password\), reset\.userId\)/,
    "the password column is not being given the hash of the new password",
  );
  assert.ok(
    !/\.bind\(\s*password\s*[,)]/.test(confirm),
    "the new password reaches the database unhashed",
  );
});

test("asking for a link cannot be used to find out who has an account", () => {
  // Enumeration is the failure mode here that still works. The route is open,
  // by design, so "is this address registered" has to cost exactly the same
  // whether or not the answer is yes: same reply, same status, same work.
  const request = between(
    route,
    "async function requestReset",
    "async function confirmReset",
  );
  // One constant, declared once. Two messages chosen per branch is how a
  // difference gets introduced later without anybody deciding to.
  assert.equal(
    (route.match(/^const GENERIC_REPLY/gm) ?? []).length,
    1,
    "there is more than one reply constant, so a branch can be given its own",
  );
  const replies = request.match(/return json\([^;]*\)/g) ?? [];
  assert.equal(
    replies.length,
    2,
    `requestReset gives ${replies.length} answers, so one branch says something the other does not`,
  );
  for (const reply of replies) {
    assert.ok(
      reply.includes("GENERIC_REPLY"),
      `a branch answers with its own message: ${reply}`,
    );
    // json() takes the status second. A reply that passes one is answering
    // differently, which is the enumeration, and the object alone is the
    // guarantee that it is not.
    assert.match(
      reply,
      /^return json\(\{[^;]*\}\)$/,
      `a branch answers with a different status: ${reply}`,
    );
  }
  // Counted before the lookup, not after it. If the limit only applied once an
  // account had been found, then a 429 would be the answer to the only question
  // this endpoint exists not to answer. Counted by key rather than by
  // occurrences of `rateLimit(`, because the comment above each call names the
  // function too and a count that includes prose is a count nobody can read.
  const lookup = request.indexOf("SELECT id, email FROM users");
  assert.ok(lookup > 0, "the account lookup has changed shape");
  for (const key of [
    "password-reset-request-email:",
    "password-reset-request-ip:",
  ]) {
    const at = request.indexOf(key);
    assert.ok(
      at > 0 && at < lookup,
      `${key} is counted after the account lookup, so the 429 itself says which addresses exist`,
    );
  }
});

test("a broken mail provider cannot turn into the same oracle", () => {
  // This is the subtle one. A deployment with no provider, or a provider that
  // is down, fails only for addresses that exist. Log the failure and answer
  // with the same sentence, and the endpoint is still useless for finding out
  // who is a customer. Throw it, and a 503 is a membership list.
  const request = between(
    route,
    "async function requestReset",
    "async function confirmReset",
  );
  const send = request.indexOf("sendPasswordResetEmail(");
  assert.ok(send > 0, "no email is sent, so no link is ever delivered");
  // The link is built inside the try as well, so a missing APP_ORIGIN - which
  // would throw while building it - lands in the same place as a provider that
  // is down rather than beside it.
  assert.match(
    request,
    /try \{[\s\S]*?RESET_LINK_PATH\}\?token=\$\{token\}[\s\S]*?await sendPasswordResetEmail\([\s\S]*?\} catch/,
    "the send is not wrapped in a try, or the link is built outside it",
  );
  const tail = request.slice(send, request.lastIndexOf("return json("));
  assert.ok(
    !/\bthrow\b/.test(tail),
    "something between the send and the reply throws, so a failure is a different status",
  );
  // The catch logs and falls through. A return in here would be a second
  // answer, and the check above would not see it.
  const caught = between(tail, "} catch", "");
  assert.ok(
    caught.length > 0 && !/\breturn\b/.test(caught),
    "the failure path returns something of its own rather than falling through to the generic reply",
  );
  assert.match(
    caught,
    /console\.error\(/,
    "a failed send is not logged, so the person running the app never finds out",
  );
});

test("a missing APP_ORIGIN must not become the same oracle", () => {
  // The same failure as a provider that is down, and reached the same way: the
  // link cannot be built, and that happens only for an address that has an
  // account. So it has to be answered the same way too. A deployment that has
  // forgotten APP_ORIGIN would otherwise 503 for exactly the addresses that
  // exist, which is the question this endpoint exists not to answer - handed
  // to whoever asks, for the length of a misconfiguration.
  //
  // Comments are stripped first. The prose in this try names APP_ORIGIN,
  // `new URL("")` and the catch, and a test that a well-worded comment can
  // pass is not a test of anything.
  const code = withoutComments(
    between(
      route,
      "async function requestReset",
      "async function confirmReset",
    ),
  );
  const start = code.indexOf("try {");
  assert.ok(start > 0, "the link is built outside a try altogether");
  const caught = code.indexOf("} catch", start);
  assert.ok(
    caught > start,
    "the try has no catch, so a failure escapes to boundary() and becomes a 503",
  );
  const block = code.slice(start, caught);

  // Inside that try, and before anything tries to parse it. setting() answers ""
  // for a setting the deployment has not set, so the check is the only thing
  // between a configuration mistake and "Invalid URL string" - which names no
  // setting, and leaves the person running the app reading a TypeError for a
  // variable they have never heard of. \s* because prettier wraps a long throw
  // onto its own line, and this is about where the guard is, not how it is set.
  assert.match(
    block,
    /if \(!origin\)\s*throw new Error\("APP_ORIGIN/,
    "APP_ORIGIN is not checked inside the try, so a missing one fails as an unparseable URL that names no setting",
  );
  const read = block.indexOf('setting("APP_ORIGIN")');
  assert.ok(
    read > 0 && read < block.indexOf("new URL("),
    "the setting is read after the URL is parsed, or outside the try, so nothing has checked it by then",
  );

  // What the catch does with it: log it and carry on. Rethrowing hands the
  // error to boundary(), which turns anything that is not an HttpError into a
  // 503 - and this one only ever happens for an address somebody registered.
  const after = code.slice(caught);
  assert.ok(
    !/\bthrow\b/.test(after),
    "the catch rethrows, so a deployment without APP_ORIGIN answers 503 to every address that has an account",
  );
  // The reply it falls through to is the generic one, with no status of its own:
  // json() takes the status second, and one passed here would be the enumeration
  // on its own.
  const answers = after.match(/return json\([^;]*\)/g) ?? [];
  assert.deepEqual(
    answers,
    ["return json({ ok: true, message: GENERIC_REPLY })"],
    `the failure path answers with something of its own: ${answers.join(" | ")}`,
  );
  // And it is the very expression the unknown-address branch returned above the
  // try, so the two responses are the same bytes rather than two wordings that
  // happen to agree today.
  assert.ok(
    code.includes(`if (!found) ${answers[0]};`),
    "the unknown-address branch and the failure path no longer share one reply",
  );
});

test("both POST actions check the origin, and the GET only reads", () => {
  // The token is emailed, so the GET is opened by a browser following a link
  // and sends no Origin at all. Demanding one there would make the feature
  // unusable - so the GET earns its exemption by writing nothing, which is
  // asserted here rather than trusted.
  const post = between(
    route,
    "export async function POST",
    "/** Ask for a link",
  );
  assert.ok(
    post.indexOf("sameOrigin(request)") >= 0 &&
      post.indexOf("sameOrigin(request)") <
        post.indexOf('action === "request"'),
    "the origin is checked after the action dispatch, or only for one of them",
  );
  assert.match(
    post,
    /if \(action === "confirm"\)/,
    "there is no confirm action",
  );
  const get = between(
    route,
    "export async function GET",
    "export async function POST",
  );
  assert.ok(
    !/\b(INSERT|UPDATE|DELETE)\b/.test(get),
    "the token check writes to the database, so skipping the origin check is not free",
  );
});

test("every step of a reset is rate limited", () => {
  // Per address, per IP and per token, each with its own number. A token limit
  // bounds guessing at a password for a known account; an address limit stops a
  // script cycling links; an IP limit stops either of those being run from a
  // list. The numbers are not asserted, the presence of an argument is: a
  // limit with no limit is a comment.
  for (const key of [
    "password-reset-request-email:",
    "password-reset-request-ip:",
    "password-reset-check-ip:",
    "password-reset-confirm-ip:",
    "password-reset-confirm-token:",
  ]) {
    const call = route.match(
      new RegExp(`rateLimit\\(\\s*\`${key}[^\`]*\`\\s*,`),
    );
    assert.ok(call, `${key} is not rate limited`);
    // The template literal held the only nested call, so what follows the comma
    // is the limit itself.
    assert.match(
      route.slice(
        call.index + call[0].length,
        call.index + call[0].length + 40,
      ),
      /^\s*\d+/,
      `${key} is called without a limit of its own`,
    );
  }
});

test("a reset password is held to the same rule as one set while signed in", () => {
  // Otherwise recovery is a way around the rule: forget your password, and the
  // new one may be shorter. Read from the source rather than from the message,
  // so the sentence cannot drift away from the check the way a hard-coded one
  // did in the sign-up form.
  const confirm = between(route, "async function confirmReset");
  const floor = Number(confirm.match(/password\.length < (\d+)/)?.[1]);
  const ceiling = Number(confirm.match(/password\.length > (\d+)/)?.[1]);
  assert.ok(Number.isInteger(floor), "the new password has no minimum length");
  assert.equal(floor, 8, "a reset password may be shorter than a chosen one");
  assert.equal(ceiling, 128, "a reset password has no maximum length");
  const stated = confirm.match(/must be (\d+) to (\d+) characters/);
  assert.ok(
    stated,
    "the refusal does not state a length, so the parent cannot tell what to do",
  );
  assert.deepEqual(
    stated.slice(1).map(Number),
    [floor, ceiling],
    "the message and the check have drifted apart",
  );
});

test("the email module never puts a live token in a log", () => {
  // A provider's error body quotes the message it was handed, and a reset
  // message is the only copy of a working link. Logging the body would put
  // every working token in the log store, and a log store is a much easier
  // thing to read than the database.
  const failed = between(email, "if (!response.ok)", "\n}");
  assert.ok(failed.length > 0, "a failed send is not reported at all");
  assert.match(failed, /console\.error\(/, "a failed send is not logged");
  // The only two things read off the response. `ok` to decide, `status` to say
  // how it went; anything else here is the body.
  const reads = [
    ...new Set(
      [...failed.matchAll(/response\.(\w+)/g)].map((match) => match[1]),
    ),
  ].sort();
  assert.deepEqual(
    reads,
    ["ok", "status"],
    "the failure path reads something off the response other than its status, which is how a token reaches the log",
  );
  // The success path says nothing at all, because the only thing it holds is
  // the text, and the text holds the link.
  const sent = between(email, "export async function sendPasswordResetEmail");
  assert.ok(
    !/console\./.test(sent),
    "the password reset message is logged, and it contains the link",
  );
  assert.ok(
    !/console\.log/.test(email),
    "something in the email module logs, and there is only one thing it could be logging",
  );
  // Unconfigured is a throw, not a quiet success. Swallowed, a parent is told
  // an email is on its way that never was, and has no reason to look again.
  const send = between(email, "export async function sendEmail");
  assert.match(
    send,
    /if \(!emailReady\(\)\) throw new Error\("Email delivery is not configured\."\)/,
    "an unconfigured provider is allowed to succeed silently",
  );
  assert.match(
    email,
    /Boolean\(setting\("RESEND_API_KEY"\) && setting\("EMAIL_FROM"\)\)/,
    "email is considered ready without both settings",
  );
  assert.ok(
    send.indexOf("emailReady()") < send.indexOf("await fetch("),
    "the configuration is checked after the request is already sent",
  );
});

test("the reset page checks the link before it shows a password box", () => {
  // The token arrives in the URL, which is the least trustworthy thing on the
  // page: anyone can put anything after the ? and follow the link. Rendering a
  // password field on the strength of it would put a form in front of a stranger
  // on a page whose address says the token is real. The check is what lets the
  // page say "already used" before anybody has typed a password.
  assert.ok(
    page.includes("/api/password-reset/check"),
    "the token in the URL is trusted without asking the server whether it is live",
  );
  // Ready is reachable only from a reply that carried an address, and the form
  // refuses to submit in any other stage.
  assert.match(
    page,
    /result\.ok\s*\?\s*\{ state: "ready", email: result\.email, token \}/,
    "the ready stage is not gated on the server confirming the token",
  );
  assert.match(
    page,
    /if \(stage\.state !== "ready"\) return;/,
    "the form can be submitted before the link has been checked",
  );
  // Read in the browser rather than handed in from the server: it exists only in
  // this page's URL, and window does not exist while this renders on a server.
  const effect = between(page, "useEffect(", "}, []);");
  assert.ok(
    effect.includes('new URLSearchParams(window.location.search).get("token")'),
    "the token is not read from the URL in the browser",
  );
  assert.equal(
    (page.match(/window\.location\.search/g) ?? []).length,
    1,
    "the token is read from the URL somewhere other than the one checked place",
  );
});

test("the page shows the server's sentence, not one of its own", () => {
  // A parent who mistypes their address is the person most likely to use this,
  // and they are the person who must not be able to tell that they mistyped it.
  // So the component has no success message of its own: whatever the route
  // said is what is on screen, which is the one wording both branches share.
  const request = between(
    account,
    "async function requestReset",
    "async function pay",
  );
  assert.match(
    request,
    /setNotice\(result\.message\)/,
    "the account page does not show the message the server sent",
  );
  // A non-empty literal is what would be a message of its own. setNotice("")
  // clears a previous notice and is the opposite of a reply.
  assert.ok(
    !/setNotice\(\s*"(?!\s*"\s*\))/.test(request),
    "the account page has a hard-coded success message, which is how a mistyped address gets told apart from a real one",
  );
  // The static line under the form is help about a missing email, not the
  // answer to the request, and is deliberately allowed to exist: it says the
  // same thing either way. Only the reply is the server's.
  assert.match(
    account,
    /Check the junk folder if nothing arrives/,
    "the form no longer says where to look if the email does not arrive",
  );
});

test("the migration can be run on a live database without asking twice", () => {
  // Applied to a database that already has the table, and to one that does not.
  // So IF NOT EXISTS on both the table and every index, and nothing that
  // destroys what is already there. A migration that drops a column to rename
  // it is fine in a branch and not fine at eight in the morning.
  const sql = migration.replace(/--[^\n]*/g, "");
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS password_resets/,
    "the table is created unconditionally, so the migration cannot be run twice",
  );
  // The IF NOT EXISTS is optional in the match so the index name can be read
  // back and asserted on, rather than counting indexes and trusting that every
  // one of them carried it.
  const indexes = [
    ...sql.matchAll(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/g,
    ),
  ];
  assert.ok(indexes.length >= 1, "the migration creates no indexes at all");
  for (const [, unique = "", name] of indexes) {
    assert.match(
      sql,
      new RegExp(
        `CREATE\\s+${unique}INDEX\\s+IF NOT EXISTS\\s+${name.replace(/[()]/g, "\\$&")}`,
      ),
      `${name} is created unconditionally, so the migration cannot be run twice`,
    );
  }
  // Matched as statements rather than as the words. `ON DELETE CASCADE` is a
  // rule about what happens when an account row goes, and it is the reason
  // resetting does not leave reset rows behind; it destroys nothing when this
  // file runs. `DROP` and a bare `DELETE FROM` are a different thing entirely.
  assert.ok(
    !/\b(DROP|ALTER)\b/.test(sql) && !/\bDELETE\s+FROM\b/.test(sql),
    "the migration drops or deletes something, which is not what an addition to a live database should do",
  );
  // Unique on the digest, so one token cannot be two rows and outlive the single
  // use it was issued for.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token ON password_resets\(token_hash\)/,
    "the token index is not unique, so a token could back more than one row",
  );
});
