/**
 * The 11+ information page.
 *
 * One page, in sections, rather than a set of separate articles. A parent
 * deciding whether this is worth paying for does not want ten links; they want
 * to be able to read what the 11+ is, what the papers are, when everything
 * happens, and what is actually worth doing about it, in one sitting.
 *
 * The sections are grouped so the table of contents can stay short while the
 * page stays long. Content is data, so this can grow without touching code.
 */
import infoData from "../../data/info/sections.json" with { type: "json" };

export type InfoSource = { title: string; publisher: string; url: string };

export type InfoTable = {
  /** Column headings, left to right. */
  head: string[];
  rows: string[][];
  /** An optional line under the table, for a caveat that matters. */
  note?: string;
};

export type InfoSection = {
  /** Anchor, so a section can be linked to directly. */
  id: string;
  /** The group in the table of contents, e.g. "The papers". */
  group: string;
  heading: string;
  /** The one-line version, used in the contents list. */
  summary: string;
  body: string[];
  /** A short list, when a section is better as one. */
  points?: string[];
  table?: InfoTable;
  /** Dated figures or named details, shown as a callout. */
  figures?: { label: string; value: string }[];
  sources?: InfoSource[];
};

export type InfoPage = {
  title: string;
  standfirst: string;
  updated: string;
  intro: string[];
  keyPoints: string[];
  sections: InfoSection[];
  sources: InfoSource[];
};

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Deep copies, so a caller cannot mutate what every other caller sees. */
export function infoPage(): InfoPage {
  const page = infoData as InfoPage;
  return clone({
    ...page,
    intro: [...page.intro],
    keyPoints: [...page.keyPoints],
    sections: page.sections.map((section) => ({
      ...section,
      body: [...section.body],
      keyPoints: undefined,
      points: section.points ? [...section.points] : undefined,
      sources: section.sources ? [...section.sources] : undefined,
      figures: section.figures ? section.figures.map((f) => ({ ...f })) : undefined,
      table: section.table
        ? {
            head: [...section.table.head],
            rows: section.table.rows.map((row) => [...row]),
            note: section.table.note,
          }
        : undefined,
    })),
    sources: [...page.sources],
  });
}

/** The groups, in the order they first appear, for the contents list. */
export function infoGroups(): { name: string; sections: InfoSection[] }[] {
  const groups: { name: string; sections: InfoSection[] }[] = [];
  for (const section of infoPage().sections) {
    const existing = groups.find((group) => group.name === section.group);
    if (existing) existing.sections.push(section);
    else groups.push({ name: section.group, sections: [section] });
  }
  return groups;
}

export function infoSection(id: string): InfoSection | null {
  return infoPage().sections.find((section) => section.id === id) ?? null;
}

export const infoSectionIds = () => infoPage().sections.map((section) => section.id);

export const isInfoSectionId = (value: string) => ID.test(value);
