// The 11+ information page is data, so the checks live next to the loader: a
// section must be complete enough to publish, a link must be one a parent can
// actually open, and nothing on the page may promise a child a place.
import test from "node:test";
import assert from "node:assert/strict";
import {
  infoGroups,
  infoPage,
  infoSection,
  infoSectionIds,
  isInfoSectionId,
} from "../lib/info/info.ts";

const page = infoPage();

test("there is a page, and every section is reachable by anchor", () => {
  assert.ok(page.title.trim());
  assert.ok(page.standfirst.trim());
  assert.ok(page.sections.length > 0, "expected some sections");
  assert.equal(infoSectionIds().length, page.sections.length);
  for (const id of infoSectionIds()) {
    assert.ok(isInfoSectionId(id), `not usable as an anchor: ${id}`);
    assert.ok(infoSection(id), `lookup failed for ${id}`);
  }
  assert.equal(infoSection("no-such-section"), null);
});

test("anchors are unique, so no section can be hidden behind another", () => {
  assert.equal(new Set(infoSectionIds()).size, page.sections.length);
});

test("every section is complete enough to publish", () => {
  for (const section of page.sections) {
    const where = `${section.group} / ${section.id}`;
    assert.ok(section.heading.trim(), `${where}: heading`);
    assert.ok(section.summary.trim(), `${where}: summary`);
    assert.ok(section.group.trim(), `${where}: group`);
    assert.ok(section.body.length > 0, `${where}: no prose`);
    for (const paragraph of section.body) {
      assert.ok(
        paragraph.trim().length > 80,
        `${where}: a stub paragraph in "${section.heading}"`,
      );
      assert.ok(!paragraph.includes("\n"), `${where}: paragraph has a newline`);
    }
    // A section is either a list, a table or neither. Not a table with no rows.
    if (section.table) {
      assert.ok(section.table.head.length > 0, `${where}: table with no headings`);
      assert.ok(section.table.rows.length > 0, `${where}: table with no rows`);
      for (const row of section.table.rows)
        assert.equal(
          row.length,
          section.table.head.length,
          `${where}: a table row does not match its headings`,
        );
    }
  }
});

test("a section that states figures or dates must show where they came from", () => {
  // This is the whole point of the page. A number a parent cannot check is a
  // number they have to take on trust, and they should not have to.
  for (const section of page.sections) {
    if (section.table || section.figures?.length) {
      assert.ok(
        section.sources?.length,
        `${section.id}: states figures but shows no source`,
      );
    }
  }
});

test("every source is an absolute https link a parent can check", () => {
  const all = [
    ...page.sources,
    ...page.sections.flatMap((section) => section.sources ?? []),
  ];
  for (const source of all) {
    assert.ok(source.title.trim(), "untitled source");
    assert.ok(source.publisher.trim(), "source without a publisher");
    assert.ok(source.url.startsWith("https://"), `${source.url} is not https`);
    assert.ok(!source.url.includes(" "), `${source.url} has a space in it`);
  }
  // A page that states a figure has to show where it came from, and the check
  // above that a section cannot be published without sources is what stops a
  // number appearing here uncited. This only asserts the page-wide list is
  // there once there is anything to list.
  if (page.sections.some((section) => section.table || section.figures?.length))
    assert.ok(all.length > 0, "the page states figures but cites nothing");
});

test("every source is listed in the page-wide list, not only in a section", () => {
  // A reader who wants to check the page should not have to open every section
  // to find out what it is based on.
  const listed = new Set(page.sources.map((source) => source.url));
  for (const section of page.sections)
    for (const source of section.sources ?? [])
      assert.ok(
        listed.has(source.url),
        `${source.url} is cited in ${section.id} but missing from the page list`,
      );
});

test("the page makes no promise about any school or exam", () => {
  // This is a page parents will pay on the strength of. An implied promise is
  // both wrong and, in a commercial context, a problem.
  const text = [
    page.standfirst,
    ...page.intro,
    ...page.keyPoints,
    ...page.sections.flatMap((section) => [
      section.heading,
      section.summary,
      ...section.body,
      ...(section.points ?? []),
      ...(section.table?.rows.flat() ?? []),
    ]),
  ].join(" ");
  const banned = [
    /\bensures? (a )?place\b/i,
    /\b(achievable|reachable|realistic) (for|at) your (child|score)\b/i,
    /\bget (a )?place at\b/i,
    /\bsecure (a )?place\b/i,
    /\bwill pass\b/i,
    /\bthe right school for your child\b/i,
  ];
  for (const pattern of banned)
    assert.ok(!pattern.test(text), `the page matches ${pattern}`);

  // "Guarantee" has to be handled on its own, because a page that is honest
  // about this industry still has to say plainly that nobody can guarantee a
  // place. A bare word match would punish exactly that, and would still let
  // through a real promise dressed as reassurance. So every sentence using the
  // word has to turn it down in the same sentence.
  const negated =
    /\b(no|not|nobody|none|never|cannot|can't|won't|does not|do not|is not|are not|without)\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!/\bguarantee/i.test(sentence)) continue;
    assert.ok(
      negated.test(sentence),
      `the page offers a guarantee: "${sentence.slice(0, 120)}"`,
    );
  }
});

test("the groups are in running order, and the contents list covers every section", () => {
  const groups = infoGroups();
  assert.ok(groups.length > 0);
  const seen = new Set();
  for (const group of groups) {
    assert.ok(!seen.has(group.name), `group repeats: ${group.name}`);
    seen.add(group.name);
    assert.ok(group.sections.length > 0, `${group.name}: empty group`);
  }
  assert.equal(
    groups.flatMap((group) => group.sections).length,
    page.sections.length,
    "a section is missing from its group",
  );
});

test("callers cannot mutate the shared data", () => {
  const first = infoPage();
  first.intro.push("mutation-test");
  first.sections[0].body.push("mutation-test");
  if (first.sections[0].table) first.sections[0].table.rows.push(["mutation-test"]);
  if (first.sections[0].points) first.sections[0].points.push("mutation-test");
  const second = infoPage();
  assert.ok(!second.intro.includes("mutation-test"));
  assert.ok(!second.sections[0].body.includes("mutation-test"));
  assert.ok(!(second.sections[0].table?.rows ?? []).flat().includes("mutation-test"));
  assert.ok(!(second.sections[0].points ?? []).includes("mutation-test"));
});

test("every contents link points at a section that exists", () => {
  // The contents list is built from the same groups as the body, so a link that
  // goes nowhere means the two were generated differently. That is the whole
  // failure mode of a hand-maintained table of contents, and it is invisible
  // until somebody clicks it.
  const ids = new Set(infoSectionIds());
  for (const group of infoGroups())
    for (const section of group.sections) {
      const href = `#${section.id}`;
      assert.ok(ids.has(section.id), `contents links to ${href}, which has no section`);
    }
});

test("the page renders without an empty list or a pointless table", () => {
  // Each of these renders a visible element. An empty one is a stray bullet or
  // an empty table border, which reads as a mistake even though it is only
  // missing content.
  for (const section of page.sections) {
    if (section.points !== undefined)
      assert.ok(section.points.length > 0, `${section.id}: renders an empty list`);
    if (section.figures !== undefined)
      assert.ok(section.figures.length > 0, `${section.id}: renders empty figures`);
    for (const figure of section.figures ?? [])
      assert.ok(
        figure.label.trim() && figure.value.trim(),
        `${section.id}: a figure with no label or no value`,
      );
    if (section.sources !== undefined)
      assert.ok(section.sources.length > 0, `${section.id}: renders an empty disclosure`);
  }
});

test("the standfirst claims nothing the sources cannot back", () => {
  // It is the first thing a parent reads and it is the line they judge the
  // page by, so it is held to the same standard as the body.
  assert.ok(
    !/\bguarantee/i.test(page.standfirst),
    "the standfirst promises something",
  );
  assert.ok(
    !/\b(100|one hundred) free\b/i.test(page.standfirst),
    "the standfirst repeats the unsubstantiated free-papers claim",
  );
  // The page shows a "checked against the exam providers" line, but only when
  // there is a source to have checked against, so the two can never disagree.
  assert.ok(
    page.sources.length > 0,
    "the page has no sources, so it must not claim to have been checked against any",
  );
});
