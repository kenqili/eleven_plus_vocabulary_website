/**
 * Register an account that can actually be signed into.
 *
 * Registering no longer hands out a session: the address has to be confirmed
 * first, which is the point of that change and not something a test should have
 * to work around ten times. So every suite that needs a signed-in child now
 * creates the account and then confirms it.
 *
 * The confirmation is done by stamping the column directly rather than by opening
 * the emailed link, because these suites are about other features and the
 * confirmation flow has its own suite (`email-verification.integration.mjs`).
 * Using the real link here would test the same thing nine more times while making
 * every one of them depend on a token nobody can read.
 *
 * `signup` is the alternative: the raw register response, for the one suite whose
 * subject is what registration returns.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";

/** A throwaway address and password, so callers do not each invent one. */
export const credentials = (label = "test") => ({
  email: `${label}-${randomUUID()}@example.test`,
  password: `Test-only-${randomUUID()}`,
});

export const post = (path, body, cookie) =>
  fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

/**
 * Mark an address confirmed, directly.
 *
 * For the suites whose subject is not the confirmation itself. Uses the database
 * rather than the link, so it does not need the token that only an email could
 * have delivered.
 */
export function confirmAddress(email) {
  const db = new DatabaseSync(process.env.TEST_NODE_DB);
  try {
    db.prepare("UPDATE users SET email_verified_at=? WHERE email=?").run(
      Date.now(),
      email,
    );
  } finally {
    db.close();
  }
}

/** Register, confirm, and sign in. Returns the cookie and the user id. */
export async function signedUp(label = "test") {
  const { email, password } = credentials(label);
  const response = await post("/api/auth/register", { email, password });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200)
    throw Error(`register failed: ${response.status} ${JSON.stringify(body)}`);

  // Confirm it. Direct, because the point of this helper is to get past the gate
  // rather than to exercise it.
  confirmAddress(email);

  const login = await post("/api/auth/login", { email, password });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw Error("sign in produced no cookie");
  return { email, password, cookie, id: body.user.id };
}
