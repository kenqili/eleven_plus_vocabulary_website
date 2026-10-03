/**
 * The canonical origin, in one place.
 *
 * Read from `APP_ORIGIN` when it is set and falling back to the site's own address
 * otherwise. `APP_ORIGIN` is already required by `billingReady()` and is the value
 * the Stripe return URLs and the emailed links are built from, so using it here
 * means a sitemap, a canonical URL and a password-reset link cannot end up
 * describing three different sites.
 *
 * The fallback rather than a hard-coded string because a hard-coded one is wrong on
 * every deployment that is not the default, and a sitemap with the wrong host is
 * worse than no sitemap - a crawler is told the pages are somewhere they are not.
 * It is read at build time, which is when Next renders these, so a deployment
 * builds with the origin it will serve.
 */
export const SITE_URL =
  process.env.APP_ORIGIN?.replace(/\/$/, "") || "https://minewords.app";

/**
 * The pages a search engine is allowed to read.
 *
 * One list, and three things depend on it: the `X-Robots-Tag` header in
 * `next.config.ts`, the sitemap, and `tests/seo.test.mjs`. It is a list rather than
 * three separate ones because the failure it prevents is a page that is allowed by
 * one and refused by another, which no test would otherwise catch and which shows
 * up in production as a page that is in the sitemap and cannot be crawled.
 *
 * Deliberately not "everything except". A denylist fails open - a page added later
 * is indexable until somebody remembers to exclude it - and the pages that must not
 * be indexable are a child's practice screen, an account area and a reading list.
 */
export const INDEXABLE_PAGES = [
  /** The landing page. Highest priority because it is the one meant to be found. */
  "",
  "about",
  "how-to",
  "info",
  "privacy",
] as const;

/**
 * The `<title>` and description for each indexable page.
 *
 * Written per page rather than templated, because the one thing a search result
 * shows is the title and the snippet, and a template produces the same sentence for
 * five different pages - which is how a site ends up ranked for a phrase none of
 * its pages actually says.
 *
 * The descriptions follow the shape a result is read in: what it is, then what a
 * parent gets, then the objection. Length is kept under about 160 characters
 * because that is roughly where a snippet is cut, and a description that gets cut
 * mid-sentence is worse than a shorter whole one.
 */
export const PAGE_METADATA: Record<
  string,
  { title: string; description: string }
> = {
  "": {
    title: "11+ Vocabulary Practice | Free 7-Day Trial — MineWords",
    description:
      "Free 11+ vocabulary practice for English and verbal reasoning. Thousands of words with meanings, synonyms and antonyms. Printable word sheets, free for 7 days.",
  },
  about: {
    title: "About MineWords — 11+ Vocabulary Practice",
    description:
      "Who made MineWords, what it covers, and what it does not: 11+ English and verbal reasoning vocabulary. Maths and non-verbal reasoning are out of scope.",
  },
  "how-to": {
    title: "How to Use MineWords — 11+ Vocabulary for Your Child",
    description:
      "A five-minute-a-day routine for 11+ vocabulary, how to read your child's progress, and how to print the words they keep getting wrong.",
  },
  info: {
    title: "The 11+ Explained — English and Verbal Reasoning",
    description:
      "What the 11+ English and verbal reasoning papers actually test, and why vocabulary decides so much of the score. Plain English, no jargon.",
  },
  privacy: {
    title: "Privacy — What MineWords Stores, and How to Delete It",
    description:
      "One email address, one row per question answered. No advertising, no third-party sharing, and one button removes all of it.",
  },
};
