// The human check in front of the forms that make the site work for strangers.
//
// Two failures matter here and they pull in opposite directions. A guard that
// quietly lets everything through when it is misconfigured is worse than no
// guard, because the site looks protected and is not. A guard that demands a
// token from a local checkout - where there are no keys and no widget - makes
// every developer and every test suite fight it, which is how guards get removed.
//
// So the subject is the seam: off until both settings exist, and once they do,
// nothing passes without Cloudflare saying so.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const workersEnv = {};
globalThis.__minewordsTestEnv = workersEnv;

let turnstilePromise = null;

/**
 * The module, through the Workers env alias.
 *
 * `setting()` reads the Worker binding first and `process.env` second, and the
 * bindings are what a deployment actually has. Loading it this way means the
 * settings can be changed between tests, which is the whole point: the same
 * code has to behave differently switched on and switched off.
 */
function turnstileModule() {
  turnstilePromise ??= createServer({
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
  }).then((server) => {
    servers.push(server);
    return server.ssrLoadModule("/lib/server/turnstile.ts");
  });
  return turnstilePromise;
}

const servers = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

const SITE_KEY = "0x4AAAAAAA_site";
const SECRET = "0x4AAAAAAA_secret";

function configure(settings) {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  Object.assign(workersEnv, settings);
  return turnstileModule();
}

/** Records the siteverify call and answers with `answer`. */
function captureVerify(answer) {
  const calls = [];
  const original = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : null,
    });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
      console.error = originalError;
    },
  };
}

const rejects = (promise, check) =>
  assert.rejects(promise, (error) => {
    check(error);
    return true;
  });

test("with no keys, the check is off and asks Cloudflare nothing", async () => {
  const turnstile = await configure({});
  assert.equal(turnstile.turnstileRequired(), false);
  // Nothing to render, so no page shows a widget whose answer is ignored.
  assert.equal(turnstile.turnstileClientKey(), "");

  const verify = captureVerify({ success: true });
  try {
    await turnstile.requireTurnstile(undefined);
    // Every submission still works: this is a local checkout or a deployment
    // that has not been switched on yet, and neither can solve a challenge.
    assert.deepEqual(verify.calls, []);
  } finally {
    verify.restore();
  }
});

test("a public key alone is not enough to demand a token", async () => {
  const turnstile = await configure({ TURNSTILE_SITE_KEY: SITE_KEY });
  // A widget with no secret behind it is a puzzle solved for nothing, so the
  // site neither renders one nor demands one.
  assert.equal(turnstile.turnstileRequired(), false);
  assert.equal(turnstile.turnstileClientKey(), "");
  await turnstile.requireTurnstile(undefined);
});

test("with both keys, a missing token is refused before any call", async () => {
  const turnstile = await configure({
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  assert.equal(turnstile.turnstileRequired(), true);
  assert.equal(turnstile.turnstileClientKey(), SITE_KEY);

  const verify = captureVerify({ success: true });
  try {
    for (const missing of [undefined, "", 42, null]) {
      await rejects(turnstile.requireTurnstile(missing), (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, "human_check");
      });
    }
    assert.deepEqual(
      verify.calls,
      [],
      "an empty token was sent to Cloudflare to be checked",
    );
  } finally {
    verify.restore();
  }
});

test("a token is checked with the secret and the visitor's address", async () => {
  const turnstile = await configure({
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  const verify = captureVerify({ success: true });
  try {
    await turnstile.requireTurnstile("token-from-widget", "203.0.113.7");
    assert.equal(verify.calls.length, 1);
    const [call] = verify.calls;
    assert.equal(
      call.url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.deepEqual(call.body, {
      secret: SECRET,
      response: "token-from-widget",
      remoteip: "203.0.113.7",
    });
  } finally {
    verify.restore();
  }
});

test("the address is left out when there is none", async () => {
  const turnstile = await configure({
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  const verify = captureVerify({ success: true });
  try {
    await turnstile.requireTurnstile("token", null);
    assert.equal("remoteip" in verify.calls[0].body, false);
  } finally {
    verify.restore();
  }
});

test("a token Cloudflare rejects is a refusal, not a pass", async () => {
  const turnstile = await configure({
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });

  for (const answer of [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    {},
  ]) {
    const verify = captureVerify(answer);
    try {
      await rejects(turnstile.requireTurnstile("spent"), (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, "human_check");
      });
    } finally {
      verify.restore();
    }
  }
});

test("a check that cannot be reached fails closed", async () => {
  const turnstile = await configure({
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  const verify = captureVerify(new Error("network down"));
  try {
    await rejects(turnstile.requireTurnstile("token"), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "human_check");
    });
    assert.equal(verify.calls.length, 1);
  } finally {
    verify.restore();
  }
});

test("every form that can make the site send mail is behind the check", () => {
  const read = (name) =>
    readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  // The routes: the guard has to run before the work. [file, the call]
  const routes = [
    "app/api/contact/route.ts",
    "app/api/auth/[action]/route.ts",
    "app/api/password-reset/[action]/route.ts",
  ];
  for (const file of routes) {
    assert.match(
      read(file),
      /await requireTurnstile\(/,
      `${file} does not check the human check, so it can be used by a script`,
    );
  }
  // And the forms: a visitor is only asked when the server will verify.
  const forms = [
    ["components/minewords/contact-form.tsx", /<Turnstile/],
    ["components/minewords/account.tsx", /<Turnstile/],
  ];
  for (const [file, pattern] of forms) {
    assert.match(read(file), pattern, `${file} renders no widget`);
  }
  for (const page of ["app/contact/page.tsx", "app/account/page.tsx"]) {
    assert.match(
      read(page),
      /turnstileClientKey\(\)/,
      `${page} does not pass the key, so the widget never appears`,
    );
    // And the key is read per request. A page that is built ahead of time
    // bakes in whichever key existed then, which is usually none, and the
    // widget silently never appears on the deployment that has keys.
    assert.match(
      read(page),
      /export const dynamic = "force-dynamic"/,
      `${page} may be prerendered, which would freeze the public key at build time`,
    );
  }
});
