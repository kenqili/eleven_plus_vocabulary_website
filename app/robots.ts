import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/server/origin";

/**
 * What a crawler is allowed to fetch.
 *
 * `robots.txt` disallowing a URL and a `noindex` header are different things, and
 * getting them the wrong way round is the classic way to lose a page from an index
 * permanently: a disallowed URL cannot be crawled, so its `noindex` is never read,
 * and a page that was once linked from elsewhere stays listed as a bare URL forever.
 *
 * So nothing is disallowed here. The pages that must stay out of results carry the
 * header instead, which is written in `next.config.ts` and asserted by
 * `tests/seo.test.mjs`. That way a crawler can read the directive on each page, and
 * a page that is not mentioned in the config is simply not indexable.
 *
 * Worth knowing: `robots.txt` at `/robots.txt` is itself fetched by nobody who is
 * blocked, because the file does not block anything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // The sitemap is how the pages that may be indexed get found at all. Read from
    // the Workers environment rather than hard-coded, so it is correct on a
    // deployment whose domain differs from the default in this repository — and read
    // from the *binding*, since `APP_ORIGIN` is a secret and not in `process.env`.
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
