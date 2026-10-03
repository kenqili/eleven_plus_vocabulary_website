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
import { only } from "./helpers/migrations.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTE = "app/api/password-reset/[action]/route.ts";
const route = read(ROUTE);
const auth = read("app/api/auth/[action]/route.ts");
const reset = read("lib/server/password-reset.ts");
const email = read("lib/server/email.ts");
const page = read("components/minewords/reset-password.tsx");
const account = read("components/minewords/account.tsx");
const security = read("components/minewords/account-security.tsx");
const migration = read("drizzle/0000_baseline.sql");

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

test("a password change is told to the owner, and only the owner", () => {
  // A password can change without the owner doing it: through a stolen session,
  // or through a reset link that somebody else read. Nothing said so before, and
  // the omission is silent - the account is simply changed and nobody is any the
  // wiser, which is the state a parent can only discover when a child cannot
  // sign in.
  //
  // So the send is asserted at both call sites rather than in email.ts. A message
  // nothing sends is still a message: asserting the function exists, or even
  // that it reads well, passes just as happily when the call is deleted from the
  // route, which is the edit somebody makes without noticing.
  const confirm = withoutComments(
    between(route, "async function confirmReset", "\n}\n"),
  );
  const change = withoutComments(
    between(auth, 'action === "password"', 'action === "signout-all"'),
  );
  // `how` is what makes the two messages different, so a route that passes the
  // wrong one is a parent told their deliberate change was a reset.
  for (const [what, source, to] of [
    ["confirmReset", confirm, "reset.email"],
    ["the password action", change, "user.email"],
  ]) {
    assert.ok(
      new RegExp(
        `await sendPasswordChangedEmail\\(\\s*${to.replace(".", "\\.")}`,
      ).test(source),
      `${what} no longer sends the password-changed notification, so the owner never hears about it`,
    );
    // Where it is sent from matters as much as that it is sent: a hard-coded
    // address would deliver this to a stranger.
    assert.ok(
      source.includes(`${to}`),
      `${what} sends the notification to something other than the account's own address`,
    );
    // The identity it came from. `at: Date.now()` - the moment the notification
    // was composed, not the moment the password changed - would leave a parent
    // who can prove they were not on site at 14:05 with nothing to weigh against.
    assert.match(
      source,
      /at: [A-Za-z][A-Za-z0-9_]*,/,
      `${what} does not pass a timestamp for when the password changed`,
    );
    assert.ok(
      !/at: Date\.now\(\)/.test(source),
      `${what} stamps the message with the moment it sends, so the time it names is not when the password changed`,
    );
    // The link is the account page, which is where the change-password form and
    // the forgotten-password control both live. A token here would be a second
    // way in that nothing asked for; this message proves nothing and must not be
    // able to do anything on its own.
    assert.match(
      source,
      /link: `\$\{new URL\(origin\)\.origin\}\/account`/,
      `${what} does not point the notification at the account page`,
    );
    assert.ok(
      !/link: `[^`]*\?token=/.test(source),
      `${what} puts a token in a message that is only a notification`,
    );
  }

  // Plain text, and no markup to render, because the other two messages in this
  // file are not HTML either and a parent should not meet two kinds of email.
  const message = between(
    email,
    "export async function sendPasswordChangedEmail",
    "export function verificationEmail",
  );
  assert.ok(
    message.length > 0,
    "there is no password-changed message, so neither route can be sending one",
  );
  assert.match(message, /\.join\("\\n"\)/, "the message is not plain text");
  assert.ok(
    !/\bhtml\b/i.test(message),
    "the message carries markup the other two do not",
  );
  // The two events have to be distinguishable, in the subject as well as the body:
  // a parent deciding whether to worry reads the subject in the list first.
  assert.match(
    message,
    /how: "changed" \| "reset"/,
    "the two routes can no longer be told apart, so both send the same message",
  );
  assert.match(message, /"Your MineWords password was changed"/);
  assert.match(message, /"Your MineWords password was reset"/);
  // The locked-out parent is the case this exists for. Somebody holding the
  // account has the password; the owner has an email and no way in, and the two
  // are the same account.
  assert.match(
    message,
    /cannot sign in/,
    "the message does not cover a parent who cannot sign in",
  );
  assert.match(
    message,
    /Forgotten your password\?/,
    "the message does not say where to recover the account, so a locked-out parent is told nothing",
  );
  // And an IP address, which the sign-in route has to hand over and this must
  // not. Not because it cannot be read - the recipient cannot act on it, and
  // whatever a stranger got hold of, this is the copy they did not choose to
  // publish.
  assert.ok(
    !/cf-connecting-ip|\bip\b/i.test(message),
    "the notification carries an IP address, which the owner cannot act on",
  );
});

test("a broken mail provider cannot stop a password being changed or reset", () => {
  // The notification is the one thing in these two routes that is not about the
  // account, so it is the one thing that can be broken by something outside:
  // no RESEND_API_KEY, no provider, no APP_ORIGIN to build the link from. It must
  // not be able to refuse the work, because the work is a parent locking
  // somebody out and then finding they cannot get back in - the situation where
  // the mail is most likely to be the thing that is already broken.
  //
  // Comments are stripped first: the prose in each try names the failure it is
  // describing, and a test a well-worded comment can pass is not a test.
  const cases = [
    [
      "confirmReset",
      withoutComments(between(route, "async function confirmReset", "\n}\n")),
    ],
    [
      "the password action",
      withoutComments(
        between(auth, 'action === "password"', 'action === "signout-all"'),
      ),
    ],
  ];
  for (const [what, source] of cases) {
    const start = source.indexOf("try {");
    assert.ok(
      start > 0,
      `${what} sends the notification outside a try altogether`,
    );
    const caught = source.indexOf("} catch", start);
    assert.ok(
      caught > start,
      `the notification in ${what} has no catch, so a provider that is down escapes to boundary() and the password is changed with a 503`,
    );
    const block = source.slice(start, caught);
    // Asked before the request is made, so a deployment with no mail configured
    // is a configuration problem in the log rather than a provider failure
    // carrying a status.
    const ready = source.indexOf("emailReady()");
    assert.ok(
      ready > 0 && ready < start,
      `${what} checks the configuration after the send has been attempted`,
    );
    // Which setting is missing, by name. `new URL("")` throws "Invalid URL
    // string", which names no setting and leaves the person reading the log with
    // a TypeError about a variable they have never heard of. And it is checked
    // inside the try on purpose: a missing APP_ORIGIN must land in the same place
    // as a provider that is down, which is nowhere near the reply.
    //
    // \s* inside the call as well as after the keyword, because prettier wraps a
    // throw whose message is too long by putting the message on the next line -
    // and it wraps it in one route and not the other, depending on the
    // indentation. This is about where the guard is, not how it is set.
    assert.match(
      block,
      /if \(!origin\)\s*throw new Error\(\s*"APP_ORIGIN/,
      `${what} does not check APP_ORIGIN before parsing it, so a missing one fails as an unparseable URL that names no setting`,
    );
    // Logged, so the failure is visible to whoever is running the site rather
    // than only to the parent who never hears anything. In the catch, which is
    // the only place it can be: the try is the part that is allowed to fail.
    assert.match(
      source.slice(caught),
      /console\.error\(/,
      `a failed notification in ${what} is not logged, so the person running the app never finds out`,
    );
    // And then nothing. A throw here is the whole failure this test exists for.
    const after = source.slice(caught);
    assert.ok(
      !/\bthrow\b/.test(after),
      `${what} rethrows after the send, so a broken mail provider stops a password being changed`,
    );
    // What it falls through to is the reply that was always going to be sent:
    // no status of its own, and for a reset the session that signs the parent
    // back in.
    if (what === "confirmReset")
      assert.match(
        after,
        /return json\(\{ ok: true \}, 200, \{\s*"Set-Cookie": await createSession/,
        "the failure path in confirmReset answers with something other than the successful reply",
      );
  }
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

test("changing a password ends the session the change was made from", () => {
  // The bug this is about is silent. The password really is changed, the other
  // devices really are signed out, the server really does keep this one alive,
  // and the page then shows a signed-in account card with nothing wrong on it -
  // so a parent who mistyped the new password sails on until the next sign-in
  // discovers it, and this account cannot be signed into at all without
  // email_verified_at. Signing the parent out here is the only moment they can
  // find out, because it is the only moment they are made to type it.
  //
  // Comments are stripped first. The prose in this flow names logout, the
  // session cookie and the notice, and a test a well-worded comment can pass is
  // a test of the comment.
  const change = withoutComments(
    between(
      security,
      "async function submit",
      "async function signOutEverywhere",
    ),
  );
  const everywhere = withoutComments(
    between(security, "async function signOutEverywhere", "\n  return ("),
  );
  // Both controls, because the second one was the same bug with worse
  // consequences: the server had already expired the cookie, so the card was
  // describing an account the parent no longer had.
  for (const [what, source] of [
    ["a password change", change],
    ["signing out everywhere", everywhere],
  ]) {
    assert.match(
      source,
      /onSignedOut\(/,
      `${what} does not tell the parent page that the session has ended, so the account card stays on screen`,
    );
  }
  // The count of other devices is the part a parent who suspects somebody else
  // is signed in is actually asking for, and it is in the message that is
  // handed over - not in a banner that is thrown away with the component.
  assert.match(
    change,
    /\$\{others\}/,
    "the message no longer says how many other devices were signed out",
  );
  assert.match(
    change,
    /=== 1 \? "one other device"/,
    "the count of one other device is no longer said in words",
  );
  // This device's own session is revoked rather than left to expire. Left alone
  // it is still a valid cookie and the account page reads it on load, so a
  // reload would put the parent back on the account card and they would never
  // type the new password - which is the thing the sign-out exists to force.
  // Asserted after the change and before the hand-off, so it is neither skipped
  // nor run against a session the server has already ended.
  const revoke = change.indexOf('"/api/auth/logout"');
  const handoff = change.indexOf("onSignedOut(");
  assert.ok(
    revoke > change.indexOf('"/api/auth/password"') && revoke < handoff,
    "a successful password change does not revoke the session the server just issued for this device",
  );
  // And it may not throw its way out of that. The password has already changed
  // and cannot be un-changed, so a failed cleanup must not be reported as a
  // failed change - and the parent is signed out of the card either way, because
  // an account on screen they no longer trust is the state being fixed.
  const caught = change.indexOf("} catch", revoke);
  assert.ok(
    caught > revoke,
    "the revoke after a password change can escape, so a network failure is shown as a change that did not happen",
  );
  assert.ok(
    !/\bthrow\b/.test(change.slice(caught)),
    "the revoke after a password change rethrows, so a failed cleanup reads as a failed change",
  );
  assert.ok(
    handoff > caught,
    "the parent is signed out on screen from inside the failure path, so a failed revoke is also a failed change",
  );
  // The child keeps no message of its own. It is rendered only while a parent is
  // signed in, so the call that signs them out unmounts it, and state held here
  // dies at the one moment it had something to say.
  assert.ok(
    !/setDone|setNotice/.test(withoutComments(security)),
    "the security component keeps its own success message, which the unmount destroys",
  );
});

test("the parent's own state is what ends, so the notice has to be the parent's", () => {
  // `user` is the only session state in this app: there is no context, no
  // provider and no store, deliberately. So the account page is the only place
  // that can take the parent off the card, and its notice is the only thing that
  // can still be on screen afterwards - the notice is rendered below the
  // signed-in branch, which is exactly why it survives the unmount that the
  // hand-off causes.
  const end = withoutComments(
    between(account, "function endSession", "async function logout"),
  );
  assert.ok(
    end.length > 0,
    "the account page has no way to end a session other than by reloading",
  );
  assert.match(end, /setUser\(null\)/, "the parent stays on the account card");
  assert.match(
    end,
    /setBilling\(null\)/,
    "the membership on screen outlives the session that was paying for it",
  );
  // The message is an argument rather than a string written here, so the count of
  // other devices signed out - which only the request knows - survives the trip
  // out of the component that is about to be unmounted.
  assert.match(
    end,
    /setNotice\(message\)/,
    "the parent's notice ignores the message it was handed, so the reason for the sign-out is lost",
  );
  assert.match(
    account,
    /<AccountSecurity\s+onSignedOut=\{endSession\}/,
    "the security component is not given the callback that signs the parent out",
  );
  // Once, and outside the signed-in branch, so it survives the sign-out that removes
  // everything inside it. A notice inside the branch is a message a parent can only
  // read for as long as the thing it is describing.
  //
  // It used to also be required to sit *after* `<DeleteAccount />`, which was how it
  // stayed outside the branch at the time - and which is why a parent returning from
  // Stripe found "Payment received" about a thousand pixels down, below the password
  // form and the delete section, with nothing scrolling them there and nothing moving
  // focus. Being outside the branch does not require being last; it requires being
  // outside. So the position is now at the top of the card, and this asserts the
  // property rather than the workaround.
  const notice = account.indexOf("{notice &&");
  assert.equal(
    (account.match(/\{notice &&/g) ?? []).length,
    1,
    "the notice is rendered in more than one place, so one of them dies with the account card",
  );
  const signedIn = account.indexOf(": user ? (");
  assert.ok(
    notice > -1 && signedIn > -1 && notice < signedIn,
    "the notice is rendered inside the signed-in branch, so it disappears when the parent is signed out",
  );
  // And above the delete section specifically, because that is the part of the card
  // a parent should never scroll past to find out whether a payment worked.
  assert.ok(
    notice < account.indexOf("<DeleteAccount />"),
    "the notice is below the delete section, so a parent who has just paid has to scroll past it to find out",
  );
});

test("the migration can be run on a live database without asking twice", () => {
  // Applied to a database that already has the table, and to one that does not.
  // So IF NOT EXISTS on both the table and every index, and nothing that
  // destroys what is already there. A migration that drops a column to rename
  // it is fine in a branch and not fine at eight in the morning.
  // The password-reset section only. This is a rule about a migration added to a
  // live database, and the baseline is not one: it creates the schema from
  // nothing, so a bare CREATE INDEX and an ALTER TABLE are what it is for. The
  // rule still applies to everything generated after it.
  const sql = only("0013_password_reset").replace(/--[^\n]*/g, "");
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
