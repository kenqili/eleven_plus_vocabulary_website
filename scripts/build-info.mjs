// Merges staged information sections into the single page data file.
//
// Each topic is staged as its own file so that a section can be written,
// checked and corrected on its own, and the page stays one document. The
// group order is fixed here rather than left to the order files happen to be
// merged in, so the contents list does not reshuffle when a topic is added.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const STAGE = new URL("../staging/info/", import.meta.url);
const OUT = new URL("../data/info/sections.json", import.meta.url);

/** The contents order a parent expects to meet it in. */
const GROUP_ORDER = [
  "Start here",
  "The papers",
  "Boys' grammar schools",
  "Girls' grammar schools",
  "Mixed grammar schools",
  "Super selective schools",
  "Preparing",
  "This app",
];

/** The page's own framing, which the staged files never touch. */
const page = JSON.parse(readFileSync(OUT, "utf8"));

// Every section lives in a staged file, including the ones about this app, so
// the page data file is a build product and there is one place to edit.
const staged = readdirSync(STAGE)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .flatMap((name) => {
    const data = JSON.parse(readFileSync(new URL(name, STAGE), "utf8"));
    if (!Array.isArray(data.sections))
      throw new Error(`${name}: expected a sections array`);
    return data.sections;
  });

if (page.sections.length)
  throw new Error(
    "The page data file has sections in it. They belong in staging/info/ so the page stays a build product.",
  );

const merged = staged;

const order = new Map(GROUP_ORDER.map((name, index) => [name, index]));
for (const section of merged)
  if (!order.has(section.group))
    throw new Error(`Unknown group: ${section.group}. Add it to GROUP_ORDER.`);

// Stable within a group, so a topic keeps the order its file declares.
const sorted = merged
  .map((section, index) => ({ section, index }))
  .sort(
    (a, b) =>
      order.get(a.section.group) - order.get(b.section.group) ||
      a.index - b.index,
  )
  .map((entry) => entry.section);

// Every cited source is listed once at the foot of the page, so a reader can
// see the whole basis without opening every section.
const sources = new Map();
for (const section of sorted)
  for (const source of section.sources ?? [])
    sources.set(source.url, source);

const byGroup = new Map();
for (const section of sorted)
  byGroup.set(section.group, (byGroup.get(section.group) ?? 0) + 1);

const next = {
  ...page,
  sections: sorted,
  // A source the page lists that no section cites any more is a dead link in
  // the bibliography, so the list is built from the sections rather than
  // merged into the old one.
  sources: [...sources.values()].sort((a, b) =>
    a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title),
  ),
};

writeFileSync(OUT, `${JSON.stringify(next, null, 2)}\n`);

const words = sorted.reduce(
  (total, section) =>
    total +
    section.body.join(" ").split(/\s+/).length +
    (section.points ?? []).join(" ").split(/\s+/).length,
  0,
);
console.log(
  `${sorted.length} sections, ${sources.size} sources, about ${words} words of prose`,
);
for (const [group, count] of byGroup) console.log(`  ${group}: ${count}`);
