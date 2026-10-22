import { setting } from "./db";
import { HttpError } from "./http";

/**
 * The human check in front of the three forms that can make the site work for a
 * stranger: contact, registration, and asking for a password reset link.
 *
 * Cloudflare Turnstile rather than Google reCAPTCHA, because the site already
 * runs on Cloudflare's network: there is no third-party script to load from
 * Google, no advertising cookie, and the server check is one HTTPS call, the
 * shape `sendEmail` already uses. It is invisible for most visitors.
 *
 * Everything here is off until both settings are present. That is deliberate:
 * a local checkout and the test suite have no keys, so the forms work there
 * exactly as they do now, and turning the check on in production is two
 * settings rather than a code change. `turnstileClientKey` is what a page
 * renders, and it is empty unless the server will actually verify a token, so
 * visitors are never asked to solve a check nobody reads.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The public key, as configured. */
const siteKey = () => setting("TURNSTILE_SITE_KEY");

/** True when a token has to be presented and verified. */
export const turnstileRequired = () =>
  Boolean(siteKey() && setting("TURNSTILE_SECRET_KEY"));

/**
 * What a page renders the widget with, or "" when the check is not in use.
 *
 * Empty when either setting is missing, not just the public one: a widget whose
 * token the server ignores is a challenge a visitor solved for nothing.
 */
export const turnstileClientKey = () => (turnstileRequired() ? siteKey() : "");

/**
 * Ask Cloudflare whether this token was issued for this site and has not been
 * used before.
 *
 * The secret travels in the body rather than the URL, and nothing about the
 * answer is logged: a token is a credential for five minutes, and a log line
 * quoting it is a log line that can be replayed. A failure is reported as a
 * failure, which is the safe way round for a spam check - the alternative is an
 * outage at Cloudflare becoming an open door here.
 */
async function verify(token: string, ip?: string | null): Promise<boolean> {
  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: setting("TURNSTILE_SECRET_KEY"),
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    if (!response.ok) {
      console.error("Human check unavailable", response.status);
      return false;
    }
    const result = (await response.json()) as { success?: unknown } | null;
    return result?.success === true;
  } catch (error) {
    console.error(
      "Human check could not be reached",
      error instanceof Error ? error.message : "Unknown error",
    );
    return false;
  }
}

/**
 * Refuse the request unless the human check passes, then return.
 *
 * Called after the cheap checks in every route - same origin, the rate limit,
 * the shape of the body - so a flood of junk is turned away before it costs a
 * call to Cloudflare. The messages are separate on purpose: a parent who did
 * not see the widget needs a different sentence from one whose token expired
 * while they were typing.
 */
export async function requireTurnstile(
  token: unknown,
  ip?: string | null,
): Promise<void> {
  if (!turnstileRequired()) return;
  if (typeof token !== "string" || !token)
    throw new HttpError(
      400,
      "Please complete the short human check, then send this again.",
      "human_check",
    );
  if (!(await verify(token, ip)))
    throw new HttpError(
      400,
      "The human check did not pass. Please try once more.",
      "human_check",
    );
}
