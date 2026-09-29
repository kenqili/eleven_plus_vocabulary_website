import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { THEME_SCRIPT_HASH } from "./lib/theme/theme-script";

/**
 * A Content-Security-Policy, with a fresh nonce for every response.
 *
 * The app needs this because the framework writes its hydration data into
 * inline <script> tags, and a policy that forbids inline script outright stops
 * the page working. The two ways out are both bad on their own. Allowing
 * `unsafe-inline` allows every inline script, including an injected one, which
 * is most of what a Content-Security-Policy is for. A single static nonce in the
 * build config is no better: the response carries the policy, so anybody can
 * read the nonce and use it.
 *
 * A per-response random nonce avoids both. The policy and the scripts it
 * permits come from the same secret, so the framework's own inline scripts run
 * and an injected one, which cannot know the nonce, does not. The framework
 * reads the nonce back out of this header and stamps it on the scripts it
 * generates, so nothing here has to know how many of them there are.
 *
 * The theme script in the document head is also inline, and it is hashed rather
 * than nonced: it has to run before this response body exists, and a hash
 * survives being moved to another file or served from a cache.
 *
 * Everything else the app loads is same-origin, and the third-party allowlist
 * is empty on purpose. There is no analytics, no font CDN and no error reporter,
 * so an allowance for any of them would be an allowance this app does not need.
 */
const NONCE_BYTES = 16;

function policyFor(nonce: string, themeScriptHash: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${themeScriptHash}'`,
    // React writes inline styles for the progress bar transform and the burst
    // rotation, so styles cannot be nonced the same way. This is the one
    // concession, and it is confined to styles, which cannot execute.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  // base64 without padding is what a nonce directive wants, and the characters
  // are all safe in a header value.
  const nonce = randomBytes(NONCE_BYTES).toString("base64");
  const policy = policyFor(nonce, THEME_SCRIPT_HASH);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything, including the static assets, because the policy has to be on
  // the document response and that is the only response a browser reads.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
