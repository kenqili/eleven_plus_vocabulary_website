/**
 * The parent guides, in one list.
 *
 * There were three copies of this list - the header menu, the "Go deeper" block on
 * `/info`, and the five JSON files the route serves - and they had drifted: the
 * header and `/info` both said "three guides" and named the same three, while two
 * articles had grown into full pages and were linked from nowhere at all. A page
 * with no internal link is reachable only by its sitemap entry, which is not how a
 * parent or a crawler finds an article.
 *
 * So the list lives here, and the three places that show it read it. The article
 * text itself stays in `data/guides/<slug>.json`; this is only what a menu needs,
 * which keeps the full prose out of the client bundle the header ships.
 */
export type GuideLink = {
  /** The file in `data/guides`, and the last segment of the URL. */
  slug: string;
  /** Short enough for a menu, and for a link in a paragraph. */
  label: string;
  /** One line for a list of links, where a label alone says too little. */
  blurb: string;
};

export const GUIDES: GuideLink[] = [
  {
    slug: "when-to-start-preparing",
    label: "When to start preparing",
    blurb: "a calm timeline from Year 4 to the exam.",
  },
  {
    slug: "how-to-practise-effectively",
    label: "How to practise effectively",
    blurb: "short sessions, and mistakes revisited.",
  },
  {
    slug: "how-many-words-11-plus",
    label: "How many words to learn",
    blurb: "a practical answer, and how to prioritise.",
  },
  {
    slug: "synonyms-antonyms-11-plus",
    label: "Synonyms and antonyms",
    blurb: "why they decide 11+ English papers.",
  },
  {
    slug: "managing-exam-pressure",
    label: "Handling exam pressure",
    blurb: "keeping nerves proportionate, and when to ease off.",
  },
];

export function guideHref(slug: string) {
  return `/guides/${slug}`;
}
