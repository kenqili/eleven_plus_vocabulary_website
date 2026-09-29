import type { NextConfig } from "next";

/**
 * The headers that apply to every response and cannot break a page.
 *
 * The Content-Security-Policy is not here. It needs a fresh nonce on every
 * response, which is what proxy.ts is for, and a nonce written into a build
 * config is published in the response, so it would be no stronger than allowing
 * inline script. Splitting it this way also leaves one file deciding what the
 * browser is allowed to do, rather than two.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Cloudflare terminates TLS, so this is really set at the edge for
          // the apex and www host. Sending it here as well means the guarantee
          // survives a different edge, and a browser ignores it over plain http,
          // so local development is unaffected.
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
            // This app needs no camera, microphone, location or payment prompt.
            // Saying so means an injected script cannot ask for one.
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          // A children's app has no business in a search index, and no version
          // of these pages should be previewed by a messaging app.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
