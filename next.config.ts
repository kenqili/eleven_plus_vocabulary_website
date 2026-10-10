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
    // One list: the matcher below does not treat `/` as matching `/:path*`
    // (the front page arrived without these headers), so the same list is
    // attached to both. Shared rather than written twice, because two copies
    // of a security header is how one of them goes stale.
    const securityHeaders = [
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
    ];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/",
        headers: securityHeaders,
      },
      // The pages a search engine is allowed to read.
      //
      // They used to be refused by a blanket `X-Robots-Tag: noindex, nofollow` on
      // `/:path*`, which was a reasonable default when every page was for a child
      // and none of them was meant to be found. It is now the wrong default: the
      // front page exists to be found by a parent searching for 11+ vocabulary, and
      // a noindex header on it makes the page unreachable however good the copy is.
      //
      // Removing that blanket header is NOT enough on its own, and this is the part
      // that is easy to get wrong: a page with no robots tag at all is *indexable*.
      // Silently un-declaring the rest of the site would have put the practice
      // screen, the account area and the child's reading list into search results.
      // So the refusal is stated per path, and `tests/seo.test.mjs` asserts that
      // every route the app has is either in the indexable list or in this one.
      {
        // One line, not wrapped: tests/seo.test.mjs reads the rule with a
        // regex that needs `source:` and its pattern adjacent.
        source: "/:path(about|how-to|info|privacy|free-11-plus-vocabulary-words)",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
      {
        // The front page, named separately because the pattern above would also
        // match a future `/about-something`, and a page that has not been thought
        // about should not be indexed by accident.
        source: "/",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
      // Everything else, by name. The practice screen is a question rather than a
      // page anybody searches for; /account is behind a session; and /stories,
      // /words and the rest are the child's own material, which has no business in
      // a results page however harmless it looks.
      //
      // `:path(x)` matches ONE segment, which is a trap worth naming three times over. A
      // rule reading `/:path(words)` covers `/words` and silently does not cover
      // `/words/print`; `/:rest*` is not honoured by this framework's matcher; and a
      // two-parameter pattern like `/:path(words)/:path(manage|print)` is not either.
      // All three were found by asking the running server what headers it actually
      // sent, not by reading the matcher - so the nested routes are enumerated as
      // plain literals below. Verbose, and it cannot silently stop matching.
      {
        source:
          "/:path(practice|account|admin|stories|words|guides|calendar|rewards|confirm-email|reset-password)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // The nested pages, literally.
        source: "/words/manage",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/words/print",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/words/map",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // A utility page, not a destination: parents arrive from the header,
        // not from a search.
        source: "/contact",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // `/stories/:id` and `/guides/:slug` are dynamic, so one parameter each.
        source: "/stories/:slug",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // The seven guide URLs that redirect into /info: enumerated because
        // the parameter rule below cannot cover them without also covering
        // the three that are articles, and a response carrying both
        // directives reads as noindex. Verified live, not trusted from docs.
        source: "/guides/which-11-plus-test",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/vocabulary-for-the-11-plus",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/managing-exam-anxiety",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/understanding-english-papers",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/understanding-maths-papers",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/verbal-and-non-verbal-reasoning",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/tailoring-practice-to-your-child",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/guides/printable-vocabulary-sheets",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // The three slugs that are articles, not redirects. The parameter
        // rule that used to cover this whole directory is gone: it cannot
        // say index here and noindex above, and a response carrying both
        // would read as noindex.
        source: "/guides/when-to-start-preparing",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
      {
        source: "/guides/how-to-practise-effectively",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
      {
        source: "/guides/managing-exam-pressure",
        headers: [{ key: "X-Robots-Tag", value: "index, follow" }],
      },
    ];
  },
};

export default nextConfig;
