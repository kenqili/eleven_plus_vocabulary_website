// Whether a parent searching for 11+ vocabulary can find this site.
//
// The page work is the visible half. This is the half that decides whether any of
// it matters, and it had one setting that quietly made the whole thing impossible:
// a blanket `X-Robots-Tag: noindex, nofollow` on `/:path*`. Every page, including
// a landing page written to be found. No amount of copy fixes a page a crawler is
// told not to read.
//
// What is asserted here is that the three things which have to agree, do. A page
// allowed by the header but missing from the sitemap is findable only by a link; a
// page in the sitemap but refused by the header cannot be crawled at all, and one
// that has been linked from elsewhere stays listed as a bare URL forever. Neither
// failure shows up in a build or a test, and both look identical from outside: no
// traffic.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { INDEXABLE_PAGES, PAGE_METADATA, SITE_URL } from "../lib/seo.ts";

const config = readFileSync("next.config.ts", "utf8");

/** Whether the layout carries the front page's title and description. */
function hasFrontPageMetadata() {
  const layout = readFileSync("app/layout.tsx", "utf8");
  return (
    /default: PAGE_METADATA\[""\]\.title/.test(layout) &&
    /description: PAGE_METADATA\[""\]\.description/.test(layout) &&
    /canonical: "\/"/.test(layout)
  );
}

test("the practice screen and the account area are not indexable", () => {
  // The pages a crawler has no business reaching. This is the reason the blanket
  // header existed and it is still right for these: a question with a child's name
  // on it, and anything behind a session.
  assert.doesNotMatch(
    config,
    /noindex, nofollow[\s\S]{0,400}source: "\/:path\*"/,
    "the blanket noindex is back on every path, which makes the landing page unreachable",
  );
  // Nothing in the allowed list is one of these. Asserted rather than trusted,
  // because adding "/practice" to a list of indexable pages is a one-word change
  // and would put a child's practice screen in search results.
  for (const forbidden of [
    "practice",
    "account",
    "words",
    "stories",
    "calendar",
    "rewards",
  ]) {
    assert.ok(
      !INDEXABLE_PAGES.includes(forbidden),
      `/${forbidden} is marked indexable, and it is not a page to be searched for`,
    );
  }
});

test("the sitemap lists exactly the pages the header allows", () => {
  // The failure this catches is silent in both directions. A page in the sitemap
  // that the header refuses cannot be crawled, so it is listed and unreadable; a
  // page the header allows but the sitemap omits is reachable only by a link.
  const allowed = [...config.matchAll(/source: "\/:path\(([^)]*)\)"/g)].flatMap(
    (m) => m[1].split("|"),
  );
  // The front page is its own rule.
  allowed.push("");
  assert.deepEqual(
    [...INDEXABLE_PAGES].sort(),
    allowed.sort(),
    "the sitemap and the X-Robots-Tag rule list different pages, so some page is listed and unreadable or readable and unfound",
  );
});

test("every indexable page exists and has its own title and description", () => {
  for (const page of INDEXABLE_PAGES) {
    const file = page ? `app/${page}/page.tsx` : "app/page.tsx";
    assert.ok(
      existsSync(file),
      `${page || "/"} is in the sitemap but ${file} does not exist`,
    );
    // A page with no title of its own inherits the layout's, so five pages end up
    // with one title and a crawler weighs that as none of them being about anything.
    const source = readFileSync(file, "utf8");
    // Either the page sets its own, or - for the front page only - it is the one the
    // layout's default is written for. `app/page.tsx` is a three-line file that
    // renders a component, and giving it a second copy of the title would be two
    // places to update for no benefit.
    const setsOwn = /export const metadata|generateMetadata/.test(source);
    const isLayoutDefault = page === "" && hasFrontPageMetadata();
    assert.ok(
      setsOwn || isLayoutDefault,
      `${page || "/"} has no metadata of its own and is not the layout's default, so it is indexed under the site name`,
    );
    // And the entry it points at exists, so a rename cannot leave it undefined.
    const key = page || "";
    assert.ok(
      PAGE_METADATA[key],
      `${page || "/"} has metadata but no entry in PAGE_METADATA`,
    );
    assert.match(PAGE_METADATA[key].title, /MineWords|11\+/);
    // Descriptions get cut at roughly 160 characters in a result, and one cut
    // mid-sentence reads worse than a shorter whole one.
    assert.ok(
      PAGE_METADATA[key].description.length <= 170,
      `${page || "/"} description is ${PAGE_METADATA[key].description.length} characters and will be cut mid-sentence`,
    );
    assert.ok(
      PAGE_METADATA[key].description.length > 60,
      `${page || "/"} description is too short to be a snippet`,
    );
  }
});

test("robots.txt disallows nothing", () => {
  // The wrong way round is a classic way to lose a page permanently: a disallowed
  // URL cannot be crawled, so the noindex header on it is never read, and a page
  // linked from elsewhere stays listed as a bare URL with no title and no snippet.
  // So the header does the refusing and robots.txt stays out of the way.
  // Matched against the rules that are returned, not the file, because the file
  // explains this very trap in a comment and would match on the word alone.
  const robots = readFileSync("app/robots.ts", "utf8");
  const rules = /rules:\s*(\[[\s\S]*?\])/.exec(robots)?.[1] ?? "";
  assert.doesNotMatch(
    rules,
    /disallow/i,
    "robots.txt disallows a path, which stops it being crawled and so its noindex header never being read",
  );
  assert.match(robots, /allow: "\/"/);
  assert.match(
    robots,
    /sitemap:/,
    "robots.txt points at no sitemap, so there is nothing for a crawler to read",
  );
});

test("the canonical origin comes from APP_ORIGIN, with a real fallback", () => {
  // A hard-coded host is wrong on every deployment that is not the default one, and
  // a sitemap pointing at the wrong host is worse than no sitemap: the crawler is
  // told these pages are somewhere they are not.
  assert.match(
    readFileSync("lib/seo.ts", "utf8"),
    /process\.env\.APP_ORIGIN/,
    "the site URL is not read from configuration",
  );
  assert.match(
    readFileSync("lib/seo.ts", "utf8"),
    /\|\| "https:\/\/minewords\.app"/,
    "there is no fallback, so a build without APP_ORIGIN throws",
  );
  // And it is the same variable the Stripe return URLs and the emailed links use,
  // so a sitemap and a password-reset email cannot describe two different sites.
  assert.match(SITE_URL, /^https?:\/\//);
});

test("the landing page is the one the sitemap leads with", () => {
  // It is the page written to be found, so it is the one a crawler should reach
  // first and weight highest.
  const sitemap = readFileSync("app/sitemap.ts", "utf8");
  assert.match(sitemap, /INDEXABLE_PAGES\[0\]|index === 0 \? 1/);
  assert.equal(
    INDEXABLE_PAGES[0],
    "",
    "the sitemap does not lead with the front page",
  );
});
