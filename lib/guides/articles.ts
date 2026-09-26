import guideData from "../../data/guides/articles.json" with { type: "json" };

export type GuideSource = { title: string; publisher: string; url: string };
export type GuideSection = { heading: string; body: string[] };
export type GuideArticle = {
  slug: string;
  title: string;
  summary: string;
  readMinutes: number;
  tags: string[];
  sections: GuideSection[];
  keyPoints: string[];
  sources: GuideSource[];
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every tag in the set, most used first, for the index filter. */
export function guideTags(): string[] {
  const counts = new Map<string, number>();
  for (const article of guideArticles())
    for (const tag of article.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** Articles in file order, which is the editorial running order. */
export function guideArticles(): GuideArticle[] {
  return (guideData.articles as GuideArticle[]).map((article) => ({
    ...article,
    sections: article.sections.map((section) => ({
      heading: section.heading,
      body: [...section.body],
    })),
    keyPoints: [...article.keyPoints],
    sources: [...article.sources],
    tags: [...article.tags],
  }));
}

export function guideArticle(slug: string): GuideArticle | null {
  return guideArticles().find((article) => article.slug === slug) ?? null;
}

export function guideSlugs(): string[] {
  return guideArticles().map((article) => article.slug);
}

export const isGuideSlug = (value: string) => SLUG.test(value);
