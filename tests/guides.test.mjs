// The guides are data, so the checks live next to the loader: every article
// must be complete, linkable and internally consistent.
import test from "node:test";
import assert from "node:assert/strict";
import {
  guideArticle,
  guideArticles,
  guideSlugs,
  guideTags,
  isGuideSlug,
} from "../lib/guides/articles.ts";

const articles = guideArticles();

test("there are guides to read, and they are all reachable by slug", () => {
  assert.ok(articles.length > 0, "expected at least one guide");
  assert.equal(guideSlugs().length, articles.length);
  for (const slug of guideSlugs()) {
    assert.ok(isGuideSlug(slug), `slug should be url safe: ${slug}`);
    assert.equal(guideArticle(slug)?.slug, slug, `lookup failed for ${slug}`);
  }
  assert.equal(guideArticle("no-such-guide"), null);
});

test("slugs are unique so no article can shadow another", () => {
  assert.equal(new Set(guideSlugs()).size, articles.length);
});

test("every article is complete enough to publish", () => {
  for (const article of articles) {
    const where = article.slug;
    assert.ok(article.title.trim(), `${where}: title`);
    assert.ok(article.summary.trim().length > 40, `${where}: summary too thin`);
    assert.ok(Number.isInteger(article.readMinutes), `${where}: readMinutes`);
    assert.ok(article.readMinutes > 0 && article.readMinutes < 60, `${where}: readMinutes out of range`);
    assert.ok(article.tags.length > 0, `${where}: tags`);
    assert.ok(article.sections.length >= 3, `${where}: too few sections`);
    assert.ok(article.keyPoints.length > 0, `${where}: key points`);
    assert.ok(article.sources.length > 0, `${where}: sources`);
    for (const section of article.sections) {
      assert.ok(section.heading.trim(), `${where}: a section has no heading`);
      assert.ok(section.body.length > 0, `${where}: ${section.heading} has no prose`);
      for (const paragraph of section.body) {
        assert.ok(paragraph.trim().length > 80, `${where}: ${section.heading} has a stub paragraph`);
        assert.ok(!paragraph.includes("\n"), `${where}: ${section.heading} paragraph has a newline`);
      }
    }
  }
});

test("every source is an absolute https link a parent can check", () => {
  for (const article of articles)
    for (const source of article.sources) {
      assert.ok(source.title.trim(), `${article.slug}: untitled source`);
      assert.ok(source.publisher.trim(), `${article.slug}: source without a publisher`);
      assert.ok(
        source.url.startsWith("https://"),
        `${article.slug}: ${source.url} is not https`,
      );
    }
});

test("the guide set makes no promise about any school or exam", () => {
  // These guides are general advice, so they must not claim an outcome.
  const banned = /\b(guarantee[sd]? (a )?(place|offer|success))\b/i;
  for (const article of articles) {
    const text = [article.summary, ...article.sections.flatMap((s) => s.body)].join(" ");
    assert.ok(!banned.test(text), `${article.slug}: makes an outcome promise`);
  }
});

test("tags are lowercase and reused across articles", () => {
  for (const tag of guideTags()) assert.ok(tag === tag.toLowerCase(), tag);
  const counted = guideArticles().flatMap((a) => a.tags);
  assert.equal(new Set(counted).size, guideTags().length, "tags should be deduplicated");
});

test("callers cannot mutate the shared guide data", () => {
  const first = guideArticles();
  first[0].tags.push("mutation-test");
  first[0].sections[0].body.push("mutation-test");
  const second = guideArticles();
  assert.ok(!second[0].tags.includes("mutation-test"));
  assert.ok(!second[0].sections[0].body.includes("mutation-test"));
});
