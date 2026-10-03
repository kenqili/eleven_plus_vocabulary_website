import type { MetadataRoute } from "next";
import { INDEXABLE_PAGES } from "@/lib/seo";
import { siteUrl } from "@/lib/server/origin";

/**
 * The pages that may be indexed, and nothing else.
 *
 * Five pages. Not the practice screen, not /account, not the word manager, not the
 * child's stories - the ones a crawler has no business reaching are refused by the
 * `X-Robots-Tag` header in `next.config.ts`, and listing them here would be
 * asking for the opposite.
 *
 * A sitemap for a site whose whole job is being found by a parent searching
 * "11+ vocabulary" is the cheapest SEO there is, and it is only correct if it
 * matches what the header allows. Both are asserted against this list in
 * `tests/seo.test.mjs`, so a page added to one and not the other fails a test
 * rather than being quietly unreachable.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  // Read once rather than per entry, so every URL in the file comes from the same
  // value and a sitemap cannot end up describing two different sites.
  const origin = siteUrl();
  return INDEXABLE_PAGES.map((path, index) => ({
    url: `${origin}/${path}`.replace(/\/$/, ""),
    lastModified,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    // The front page first and highest; the privacy notice last and lowest,
    // because nobody searches for it and it is here for a parent who has been told
    // to look for it.
    priority:
      index === 0 ? 1 : index === INDEXABLE_PAGES.length - 1 ? 0.3 : 0.8,
  }));
}
