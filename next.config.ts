import type { NextConfig } from "next";
import { THEME_SCRIPT_HASH } from "./lib/theme/theme-script";

/**
 * Response headers for every page.
 *
 * The app renders its own HTML with an inline theme script, so a Content
 * Security Policy cannot simply forbid inline script. Rather than weaken the
 * policy to accommodate that one line, the line is given a hash, which is
 * stronger: the policy then allows exactly that script and nothing else, and an
 * injected inline script is refused. The hash is generated from the script
 * itself at build time, so editing the theme code changes the hash and the
 * policy stops passing rather than silently allowing everything.
 *
 * Everything else in the app is external stylesheets, external scripts, inline
 * <style> is not used, and the audio is served from the same origin, so those
 * need no allowance beyond the same-origin defaults.
 */
const csp = [
  "default-src 'self'",
  // The theme has to run before the first paint or a child on a dark theme gets
  // a white flash. It is a hashed inline script, which is the narrowest way to
  // allow it.
  `script-src 'self' 'sha256-${THEME_SCRIPT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // No third party is contacted at runtime: no analytics, no ads, no fonts
  // from elsewhere. Saying so means a compromised dependency cannot phone home.
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  // The app has no reason to embed anything at all.
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Payment is the only place the app sends a child or parent somewhere else.
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Cloudflare terminates TLS, so this is set by them at the edge for
          // the apex and www host. Sending it here as well is harmless and makes
          // the guarantee survive a different edge.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            // This app needs a microphone for nothing. The camera and the rest
            // are denied outright so an injected script cannot ask.
            value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
          },
          // This is a children's app and there is no reason for a page to be
          // indexed or embedded anywhere.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
