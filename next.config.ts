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
        ],
      },
      // The pages a search engine is allowed to read.
      //
      // They used to be refused by a blanket `X-Robots-Tag: noindex, nofollow` on
      // `/:path*`, which was a reasonable default when every page was for a child
      // and none of them was meant to be found. It is now the wrong default: the
      // front page exists to be found by a parent searching for 11+ vocabulary, and
      // a noindex header on it makes the page unreachable however good the copy is.
      //
      // So the refusal is inverted and stated as a list of what may be indexed.
      // That is the safer direction to fail in - a page added later is invisible
      // until somebody adds it here, rather than visible until somebody remembers to
      // exclude it. Everything not named stays out of the index, which is what keeps
      // the practice screen, the account area and the child's own material out of
      // results.
      //
      // Only these five. Not the practice screen, which is a question rather than a
      // page anyone searches for; not /account, which is behind a session; and not
      // anything under /stories, which is the child's own reading.
      {
        source: "/:path(about|how-to|info|privacy)",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
      {
        // The front page, named separately because the pattern above would also
        // match a future `/about-something`, and a page that has not been thought
        // about should not be indexed by accident.
        source: "/",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
    ];
  },
};

export default nextConfig;
