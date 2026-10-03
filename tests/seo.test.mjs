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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { INDEXABLE_PAGES, PAGE_METADATA, resolveOrigin } from "../lib/seo.ts";

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

test("every route is either indexable or explicitly not", () => {
  // The gap this catches is silent and total.
  //
  // Removing the blanket `noindex` from `/:path*` makes the five good pages
  // indexable — and silently makes every *other* page indexable too, because a page
  // with no robots tag is indexable. `/practice` and `/account` were carrying no tag
  // at all, so a child's practice screen and an account area would both have been
  // findable. Nothing errors, the build passes, and the failure is only visible in a
  // search results page months later.
  //
  // So this walks the app directory and requires every route to be named in one list
  // or the other. A page added later is unclassified and fails here.
  const tagsFor = (re) =>
    [...config.matchAll(/source:\s*"\/:path\(([^)]*)\)"/g)]
      // Each rule's value is the next `headers:` line, not everything after it —
      // scanning 200 characters would let one rule inherit the next one's value.
      .map((m) => ({
        paths: m[1].split("|"),
        value: /headers:\s*\[\{\s*key: "X-Robots-Tag",\s*value: "([^"]+)"/.exec(
          config.slice(m.index + m[0].length, m.index + m[0].length + 200),
        )?.[1],
      }))
      .filter((r) => re.test(r.value ?? ""));

  const indexable = tagsFor(/index, follow/).flatMap((r) => r.paths);
  const refused = tagsFor(/noindex/).flatMap((r) => r.paths);
  // The front page's rule is `source: "/"`, which the `:path(...)` pattern does not
  // match. Read separately rather than folded into a pattern, because writing it as
  // `/:path("")` would be a route that matches the empty path and is not a thing.
  if (
    /source:\s*"\/",\s*\n?\s*headers:\s*\[\{\s*key: "X-Robots-Tag",\s*value: "index, follow"/.test(
      config,
    )
  )
    indexable.push("");

  const routes = new Set([""]);
  for (const entry of readdirSync("app", { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") routes.add("");
    if (!entry.isDirectory()) continue;
    if (existsSync(`app/${entry.name}/page.tsx`)) routes.add(entry.name);
    for (const sub of readdirSync(`app/${entry.name}`, {
      withFileTypes: true,
    })) {
      if (
        sub.isDirectory() &&
        existsSync(`app/${entry.name}/${sub.name}/page.tsx`)
      )
        routes.add(`${entry.name}/${sub.name}`);
    }
  }

  // Coverage must be EXACT, and there is no first-segment fallback. An earlier version
  // of this test accepted one, on the assumption that a rule reading `/:path(words)`
  // covers `/words/print`. It does not: `:path(x)` matches one segment, `:rest*` is
  // not honoured, and a two-parameter pattern is not either — all three found by
  // asking the running server rather than by reading the matcher. So the print screen
  // was indexable while the word list was not, and the test passed. Every route must
  // be named by a rule that actually reaches it.
  //
  // Built from the rules themselves rather than restated, so the two cannot drift:
  // a literal `source` (which may be two segments), a one-parameter `/:path(a|b)`,
  // or a nested `/:path(a)/:slug` whose first segment covers everything beneath it.
  const literal = [
    ...config.matchAll(/source:\s*"\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)"/g),
  ]
    .filter((m) => !m[1].includes(":"))
    .map((m) => m[1]);
  // A rule reading `/stories/:slug` — or `/:path(stories)/:slug` — covers every
  // route beneath `stories`, because the second segment is a parameter.
  const under = [...config.matchAll(/source:\s*"\/([a-z0-9-]+)\/:\w+"/g)].map(
    (m) => m[1],
  );

  // Routes are collected from the directory tree, where a dynamic segment is
  // written `[slug]`. Normalised to its first segment, because a rule covering
  // everything under `stories` is what covers `stories/[id]`.
  const firstSegment = (route) => route.split("/")[0];

  const unclassified = [...routes].filter(
    (r) =>
      !indexable.includes(r) &&
      !refused.includes(r) &&
      !literal.includes(r) &&
      !under.includes(firstSegment(r)),
  );
  assert.deepEqual(
    unclassified,
    [],
    `these routes carry no robots directive, which means they ARE indexable: ${unclassified}`,
  );
  // And nothing is in both lists, which would be two conflicting instructions.
  const both = INDEXABLE_PAGES.filter((p) => refused.includes(p));
  assert.deepEqual(both, [], `these are both indexable and refused: ${both}`);

  // The other half, and the half the first version of this test was missing.
  //
  // Checking that every route is *classified* is not enough on its own: a route
  // wrongly marked `index, follow` is classified, and the test passed when this was
  // mutated to do exactly that - which is the original bug, where removing the
  // blanket noindex silently made the practice screen and the account area findable.
  //
  // So the set of paths the config actually allows must be exactly the list in
  // lib/seo.ts. Anything more, and a child's material is in a search results page.
  assert.deepEqual(
    [...new Set(indexable)].sort(),
    [...INDEXABLE_PAGES].sort(),
    "the config allows different pages than lib/seo.ts lists — something is indexable that should not be, or a page is listed and not allowed",
  );
  // Named explicitly, because these are the ones that matter and a reader should not
  // have to derive them from the list above.
  for (const forbidden of [
    "practice",
    "account",
    "words",
    "stories",
    "calendar",
    "rewards",
    "admin",
    "guides",
    "confirm-email",
    "reset-password",
  ]) {
    assert.ok(
      !indexable.includes(forbidden),
      `/${forbidden} carries index, follow, so it will be searchable`,
    );
  }
});

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

test("every indexable page has its own canonical URL", () => {
  // The silent page-loser. `/info` inherited the layout's
  // `alternates.canonical: "/"`, so it told a search engine it *was* the front page.
  // Google treats that as a duplicate and keeps one of the two - normally the more
  // prominent one - so a page can be reachable, indexable, in the sitemap, and still
  // never appear in a result for its own title.
  //
  // Nothing about that is visible from the outside. It does not fail a build and it
  // does not error; the page just quietly never ranks.
  for (const page of INDEXABLE_PAGES) {
    const file = page ? `app/${page}/page.tsx` : "app/page.tsx";
    const source = readFileSync(file, "utf8");
    const expected = `/${page}`;
    if (page === "") {
      // The front page's canonical is the layout's, and is correct.
      assert.match(
        readFileSync("app/layout.tsx", "utf8"),
        /alternates:\s*\{\s*canonical: "\/"/,
        "the layout has no canonical for the front page",
      );
      continue;
    }
    assert.match(
      source,
      new RegExp(`alternates:\\s*\\{\\s*canonical: "${expected}"`),
      `${expected} declares no canonical of its own, so it inherits "/" and a search engine will treat it as a duplicate of the front page`,
    );
  }
});

test("no page's title carries its own site name as well as the template's", () => {
  // The layout applies `template: "%s | MineWords"`. A page whose title already
  // ends in a brand renders both, and a search result reading
  // "... | 11+ Vocabulary Challenge | MineWords" is a page that looks machine-made.
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /template: "%s \| MineWords"/);
  for (const page of INDEXABLE_PAGES) {
    if (!page) continue;
    const source = readFileSync(`app/${page}/page.tsx`, "utf8");
    const title = /title:\s*(?:PAGE_METADATA[^\n]*|["'`]([^"'`]+))/.exec(
      source,
    );
    if (!title?.[1]) continue;
    assert.doesNotMatch(
      title[1],
      /\|\s*(MineWords|11\+\s*Vocabulary\s*Challenge)\s*$/i,
      `/${page} ends its title with a site name, which the layout template then appends again`,
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

test("the canonical origin is read from the Worker binding, not process.env", () => {
  // A hard-coded host is wrong on every deployment that is not the default one, and
  // a sitemap pointing at the wrong host is worse than no sitemap: the crawler is
  // told these pages are somewhere they are not.
  const reader = readFileSync("lib/server/origin.ts", "utf8");
  const seo = readFileSync("lib/seo.ts", "utf8");

  // The part that was wrong, and it was wrong twice. `APP_ORIGIN` is a Worker secret
  // — `wrangler secret put` puts it in the Workers `env` binding and not in
  // `process.env` — so a reader using `process.env` finds nothing once deployed,
  // falls through to its fallback, and every canonical and every sitemap entry
  // names a host that is not this site. Nothing errors; the pages are just never
  // found. The fix was `setting()`, which checks the binding first.
  assert.match(
    reader,
    /setting\("APP_ORIGIN"\)/,
    "the origin is not read from the Workers binding, so canonicals and the sitemap would name the fallback host in production",
  );

  // And the first attempt at fixing it was itself a no-op: a `require()` of
  // `lib/server/db` inside a `try`. Under Node it threw and was swallowed; inside
  // the Worker bundle `require` is not defined for an ES module, so it would have
  // thrown and been swallowed there too, and `SITE_URL` resolved to `""` — an
  // origin of nothing, and a silent failure in both places. A guarded dynamic read
  // looks like it works in every environment it fails in, which is the reason it
  // is pinned here as a static import at module scope.
  assert.doesNotMatch(
    reader,
    /\brequire\s*\(/,
    "the origin is read through a guarded require, which silently yields nothing both in Node and in the Worker bundle",
  );

  // A real domain rather than a placeholder, and never a relative one: a crawler
  // cannot resolve a relative sitemap entry at all.
  assert.match(
    seo,
    /\|\| "https:\/\/11pluswords\.com"/,
    "there is no real fallback domain, so a build without APP_ORIGIN names nothing resolvable",
  );
  assert.doesNotMatch(
    seo,
    /minewords\.app/,
    "the fallback is still the old wrong domain",
  );

  // Every consumer goes through the reader, so there is one place that reads the
  // binding and one place that can be wrong about it.
  for (const [file, why] of [
    ["app/layout.tsx", "every canonical URL"],
    ["app/sitemap.ts", "the sitemap"],
    ["app/robots.ts", "the sitemap pointer in robots.txt"],
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /siteUrl\(\)/,
      `${why} does not come from the Worker-aware origin reader`,
    );
    assert.doesNotMatch(
      source,
      /SITE_URL/,
      `${file} still uses the process.env-only SITE_URL, which is empty on the Worker`,
    );
  }
  assert.doesNotMatch(
    seo,
    /export const SITE_URL/,
    "the process.env-only SITE_URL constant is still exported, so the wrong value is still reachable",
  );
});

test("a trailing slash in the origin cannot produce a double slash in a URL", () => {
  // `APP_ORIGIN` is documented as "the public origin including scheme", which people
  // write with a trailing slash. Every consumer appends `/sitemap.xml` or `/` + a
  // path, so an untrimmed origin produces `https://site.com//about` — a URL that is
  // a different URL to a crawler, so the canonical and the sitemap disagree.
  assert.equal(
    resolveOrigin("https://11pluswords.com/"),
    "https://11pluswords.com",
  );
  // Empty is the case that actually bites: no secret set, so the fallback must still
  // be an absolute URL rather than a relative one.
  assert.match(resolveOrigin(""), /^https:\/\//);
  assert.equal(
    resolveOrigin("http://localhost:5173"),
    "http://localhost:5173",
    "a configured origin must be used as given, not replaced by the fallback",
  );
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
