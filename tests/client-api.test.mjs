/**
 * The client helper's calling convention, which every page has to follow.
 *
 * `api(path, data, options)` serialises `data` and picks the method itself. The
 * mistake this file exists to prevent is passing `{method, body}` as the second
 * argument, because that reads like a fetch call and is accepted silently: the
 * helper sends `{method: "POST", body: "..."}` as the *payload*, so whatever the
 * route actually reads from the body is absent.
 *
 * That failure is quiet in three places at once, which is why it is worth a
 * test rather than a review comment:
 *
 *   1. The server refuses with a 400 whose message names the missing field, but
 *      `boundary()` deliberately does not log an `HttpError` - it is a refusal,
 *      not a fault. So the server log says nothing.
 *   2. The client throws, so the browser console shows a stack and no cause.
 *   3. The interface shows the refusal message, which is written for a parent
 *      choosing a length and reads as "pick an option" rather than "the option
 *      never arrived".
 *
 * A route that ignores the body hides it entirely: `signout-all` was called this
 * way and worked, because it reads no fields. The same shape on a route that
 * reads one is the 400 above. So the check is on the *call shape* everywhere,
 * not on the routes that happen to break.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/** Comments stripped, so prose *about* the rule cannot fail it. */
const client = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

/** Every file that calls the shared helper. */
const CALLERS = [
  "components/minewords/account.tsx",
  "components/minewords/account-security.tsx",
  "components/minewords/admin.tsx",
  "components/minewords/coupon-redeem.tsx",
  "components/minewords/delete-account.tsx",
  "components/minewords/exclude-word.tsx",
  "components/minewords/manage-words.tsx",
  "components/minewords/reset-password.tsx",
  "components/minewords/story-reader.tsx",
];

test("no caller passes a fetch-shaped options object as the payload", () => {
  const offenders = [];
  for (const file of CALLERS) {
    const text = client(file);
    // Each `api(` call, up to its closing paren, flattened so a payload spread
    // over several lines is still one match.
    for (const call of text.matchAll(
      /api(?:<[^>]*>)?\(\s*[`"'][^`"']*[`"']\s*,\s*(\{[\s\S]{0,400}?\}|\{[^{}]*\})/g,
    )) {
      const payload = call[1];
      if (
        /"method"\s*:|method:\s*"(POST|GET|PUT|DELETE)"|JSON\.stringify/.test(
          payload,
        )
      )
        offenders.push(
          `${file}: api() takes the payload as its second argument, not a fetch options object`,
        );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the payload is sent as data rather than as the body:\n  ${offenders.join("\n  ")}\n` +
      `api() sets the method and serialises for you, so this silently sends\n` +
      `  { method: "POST", body: "{...}" }\nas the payload and the route reads nothing.`,
  );
});

test("the billing route reads the tier from the payload, so a dropped call breaks it", () => {
  // The reason this is worth a test rather than a convention: the tier is the
  // only thing the checkout route takes from the body, so the call shape is the
  // whole contract. A payload that arrives as `{method, body}` produces a 400
  // with no server log entry and a message about choosing a length.
  const route = client("app/api/billing/[action]/route.ts");
  assert.match(route, /const input = await body\(request\)/);
  assert.match(route, /input\.tier/);
  // And the client sends it under that name.
  const account = client("components/minewords/account.tsx");
  assert.match(
    account,
    /api<\{ url: string \}>\(\s*`\/api\/billing\/\$\{action\}`\s*,\s*tier \? \{ tier \} : \{\}/,
    "the checkout call does not send {tier} as its payload",
  );
});

test("the refund-shaped tier is not derivable from the URL", () => {
  // Guards against the tempting fix: moving the tier into the path
  // (`/api/billing/checkout?tier=monthly`) to avoid a body. The route reads
  // params via `context.params` and would then have two sources for the same
  // value, and the URL is the one a parent can edit.
  const route = client("app/api/billing/[action]/route.ts");
  assert.doesNotMatch(
    route,
    /searchParams\.get\("tier"\)/,
    "the tier is read from the request body, not the query string, so it cannot be edited in a URL",
  );
});
