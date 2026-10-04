/**
 * The canonical origin, from whatever the caller was able to read.
 *
 * Deliberately a function taking the value, and not a reader. Two reasons, and the
 * second is the one that cost a real bug:
 *
 * `APP_ORIGIN` is a **Worker secret**: `wrangler secret put` puts it in the Workers
 * `env` binding and *not* in `process.env`. So a module that reads `process.env`
 * finds nothing once deployed, falls through to its fallback, and every canonical
 * URL and every sitemap entry quietly names the wrong host — a host a crawler
 * resolves to a different website. Nothing errors; the pages are simply never found.
 *
 * The reading therefore has to come from `setting()` in `lib/server/db`, which
 * checks the binding first and `process.env` second. That module imports
 * `cloudflare:workers`, which does not resolve outside a Worker — so it is kept on
 * the far side of this function, and the caller does the reading. `lib/seo.ts` stays
 * importable by `tests/seo.test.mjs` under plain Node, which is what lets the tests
 * check this at all.
 *
 * The fallback is a real domain rather than a placeholder, so a build with no
 * `APP_ORIGIN` still produces a coherent absolute URL. A relative one would be
 * worse than wrong: a crawler cannot resolve a relative sitemap entry at all.
 */
export function resolveOrigin(configured: string): string {
  return configured?.replace(/\/$/, "") || "https://11pluswords.com";
}

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
      "Free English vocabulary practice for ages 9–11: 11+ English and verbal reasoning, thousands of words, funny stories and printable sheets. Free 7 days.",
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
