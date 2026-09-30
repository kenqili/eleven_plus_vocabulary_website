// The things that would matter most if this were serving a real child's account.
//
// Most of what follows is configuration rather than logic, and configuration is
// exactly what nobody re-reads after the day it was written. So it is asserted
// here, against the source, where a change that breaks it fails the suite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPLY_SAVED_THEME } from "../lib/theme/theme-script.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTES = [
  "app/api/auth/[action]/route.ts",
  "app/api/billing/[action]/route.ts",
  "app/api/challenge/route.ts",
  "app/api/password-reset/[action]/route.ts",
  "app/api/parent-words/route.ts",
  "app/api/rewards/route.ts",
  "app/api/stories/route.ts",
];

test("every route that changes state checks the request came from this site", () => {
  // sameOrigin is the cross-site defence. A SameSite cookie stops a browser
  // sending the session on a cross-site form post, but that is a browser
  // behaviour and only for browsers. An explicit check is what actually holds.
  let checked = 0;
  for (const file of ROUTES) {
    const source = read(file);
    if (!/export async function (POST|PUT|DELETE|PATCH)/.test(source)) continue;
    assert.ok(
      source.includes("sameOrigin(request)"),
      `${file} changes state but never checks the origin`,
    );
    checked += 1;
  }
  assert.ok(checked >= 5, `expected several mutating routes, found ${checked}`);
});

test("the Stripe webhook needs no origin and verifies the body instead", () => {
  // Stripe is not a browser, so it sends no Origin, and demanding one would
  // break it. What replaces the origin check is a signature over the raw body,
  // which for this route is strictly stronger. Both halves are asserted, because
  // either one alone would look like a gap to whoever read this next.
  const source = read("app/api/stripe/webhook/route.ts");
  assert.ok(
    !source.includes("sameOrigin"),
    "the webhook should not demand an Origin header",
  );
  assert.ok(
    source.includes("verifyStripeSignature"),
    "the webhook must verify the signature",
  );
  // It must sign the raw body. Re-serialising a parse and signing that would
  // mean whitespace alone changed the signature, and every real payload would
  // fail.
  assert.ok(
    source.includes("request.text()") && !source.includes("request.json()"),
    "the signature must be checked against the raw body",
  );
  const verify = read("lib/server/webhook.ts");
  assert.match(verify, /timingSafeEqual/, "the comparison must be constant time");
  // A freshness window is what stops a captured payload being replayed later.
  assert.match(verify, /300/, "no replay window on the signature");
});

test("changing a password revokes every session, not just the one in use", () => {
  // Changing a password while leaving a stolen session alive is not a fix, and
  // the combination is the reason this is one request rather than two.
  const source = read("app/api/auth/[action]/route.ts");
  const start = source.indexOf('action === "password"');
  assert.ok(start > 0, "there is no password change route");
  const section = source.slice(start);
  assert.match(
    section,
    /DELETE FROM sessions WHERE user_id = \?/,
    "changing the password must delete that account's sessions",
  );
  assert.match(section, /hashPassword\(next\)/, "the new password must be hashed");
  assert.ok(
    !/\.bind\(\s*next\s*[,)]/.test(section),
    "the new password must never reach the database unhashed",
  );
  // Unlimited guesses turn this into an oracle for the current password.
  assert.match(
    section,
    /rateLimit\(`change-password/,
    "no rate limit on changing a password",
  );
  // Without the current password, anyone holding a stolen session could take
  // the account over outright.
  assert.match(
    section,
    /verifyPassword\(current/,
    "the current password must be required",
  );
  assert.match(section, /createSession/, "the parent should stay signed in here");
});

test("the session cookie is prefixed so a subdomain cannot take it over", () => {
  // __Host- is enforced by the browser, so Secure, no Domain and Path=/ cannot
  // be broken by a later edit. It is the difference between intending to keep a
  // session off subdomains and being unable to leak one onto one.
  const source = read("lib/server/auth.ts");
  assert.ok(
    source.includes("__Host-mw_session"),
    "the production session cookie is not __Host- prefixed",
  );
  const cookie = source.slice(
    source.indexOf("const secure"),
    source.indexOf('return parts.join'),
  );
  assert.match(cookie, /"HttpOnly"/, "the cookie must be HttpOnly");
  assert.match(cookie, /SameSite=Lax/, "the cookie must set SameSite");
  assert.match(cookie, /Path=\//, "a __Host- cookie must have Path=/");
  assert.match(cookie, /if \(secure\) parts\.push\("Secure"\)/);
  // Every reader has to know both names, or signing in works on https and
  // silently fails on a laptop.
  for (const file of [
    "lib/server/auth.ts",
    "app/api/auth/[action]/route.ts",
  ])
    assert.ok(
      read(file).includes("__Host-mw_session="),
      `${file} reads the cookie but does not know the __Host- name`,
    );
});

test("the sign-up message describes the rule that is actually enforced", () => {
  // A parent who typed a ten-character password was told twelve was the
  // minimum. That is not a message a person can shrug off: it teaches them the
  // rule is arbitrary, and the fix is to make the two agree.
  const source = read("app/api/auth/[action]/route.ts");
  const floor = Number(source.match(/password\.length < (\d+)/)?.[1]);
  const stated = source.match(/password of (\S+) to (\d+) characters/);
  assert.ok(Number.isInteger(floor), "no password length check found");
  assert.ok(stated, "the error message does not state a length");
  assert.equal(
    Number(stated[1]),
    floor,
    `the message says ${stated[1]} characters and the check requires ${floor}`,
  );
});

test("an exported word list cannot become a spreadsheet formula", () => {
  // A parent can add their own words, so the export is not purely trusted data.
  // Excel and Google Sheets both execute a cell beginning with =, +, - or @.
  const source = read("lib/challenge/word-summary.ts");
  assert.match(source, /csvCell/, "CSV cells are not guarded at all");
  // The guard is a leading =, +, - or @ after optional whitespace, which is what
  // Excel, LibreOffice and Google Sheets all treat as a formula. Compared as a
  // literal, so dropping one of the four prefixes is caught.
  const guard = source.match(/const safe = (\S+)\.test/)?.[1];
  assert.equal(
    guard,
    "/^[\\s]*[=+@-]/",
    `the formula guard is ${guard}, which no longer covers every prefix`,
  );
  // Written as the escape sequence in the source, which is how it appears there.
  assert.ok(
    source.includes('\\uFEFF'),
    "no byte order mark, so Excel mis-reads every accented word",
  );
});

test("the inline theme script cannot be turned into an injection", () => {
  // It runs before any framework code, so it is the one place in the app where
  // a string built from data becomes executable. Both interpolations are
  // JSON-encoded at build time, so the rendered script contains literals only.
  assert.match(
    APPLY_SAVED_THEME,
    /localStorage\.getItem\("/,
    "the storage key is not a quoted literal",
  );
  assert.match(
    APPLY_SAVED_THEME,
    /\.indexOf\(t\)>-1/,
    "the theme is not checked against an allowlist before being applied",
  );
  // A concatenated value would show up as an unquoted join in the rendered text.
  assert.ok(
    !/getItem\([^")]*\+/.test(APPLY_SAVED_THEME),
    "the storage key is concatenated into the script",
  );
  assert.ok(
    !/\[\s*"?\w+"?\s*,/.test(APPLY_SAVED_THEME.split("indexOf(")[1] ?? ""),
    "the theme allowlist is not a literal array",
  );
  // And nothing in it may fetch, eval or reach outside the page.
  for (const forbidden of ["eval", "fetch", "XMLHttpRequest", "import(", "Function("])
    assert.ok(
      !APPLY_SAVED_THEME.includes(forbidden),
      `the theme script contains ${forbidden}`,
    );
});

test("a password is only ever stored hashed, and only compared in constant time", () => {
  const password = read("lib/server/password.ts");
  assert.match(password, /scrypt/, "passwords are not hashed with a memory-hard function");
  assert.match(password, /timingSafeEqual/, "the comparison is not constant time");
  // A session token is stored as a digest, so a database dump cannot be replayed
  // as a set of live sessions.
  assert.match(password, /tokenDigest/);
  assert.ok(
    !/createHash\("md5"|createHash\("sha1"/.test(password),
    "a broken hash function is in the password module",
  );
  const auth = read("app/api/auth/[action]/route.ts");
  // A login for an unknown address still has to do the expensive work, or the
  // time it takes to fail says which email addresses exist.
  assert.match(
    auth,
    /verifyPassword\(\s*password,\s*found\?\.password/,
    "an unknown account is rejected without doing the password work",
  );
  // The column is named password but must only ever receive a hash.
  assert.match(auth, /hashPassword\(password\)/, "the raw password is not being hashed at sign-up");
  assert.match(
    auth,
    /INSERT INTO users \(id,email,password,created_at\) VALUES \(\?,\?,\?,\?\)/,
    "the sign-up insert has changed shape, so check what goes in the password column",
  );
  assert.ok(
    /hashPassword\(password\),\s*userId/.test(auth) ||
      /\.bind\(userId, email, passwordHash, Date\.now\(\)\)/.test(auth),
    "the password column is not being given the hash",
  );
});
