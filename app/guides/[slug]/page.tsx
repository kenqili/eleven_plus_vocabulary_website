import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/minewords/header";
import whenToStart from "@/data/guides/when-to-start-preparing.json";
import howToPractise from "@/data/guides/how-to-practise-effectively.json";
import managingPressure from "@/data/guides/managing-exam-pressure.json";

type GuideArticle = {
  slug: string;
  title: string;
  description: string;
  standfirst: string;
  reviewed: string;
  sections: { heading: string; paragraphs: string[] }[];
  sources: { title: string; publisher: string; url: string }[];
};

/**
 * The guides that are articles in their own right. Everything else in MOVED
 * below stays a redirect into /info: ten thin articles would compete with the
 * page they were folded into, and a parent deciding whether to pay does not
 * want ten links.
 */
const ARTICLES: Record<string, GuideArticle> = {
  "when-to-start-preparing": whenToStart,
  "how-to-practise-effectively": howToPractise,
  "managing-exam-pressure": managingPressure,
};

// The guides became one page rather than ten articles, because a parent
// deciding whether this is worth paying for does not want ten links. Old links
// still work: each article folded into a section on the page, so anything
// shared or bookmarked lands on the right part of it rather than a 404.
// Three of the ten have since grown back into full articles above; the rest
// redirect on.
const MOVED: Record<string, string> = {
  "which-11-plus-test": "what-the-11-plus-is",
  "vocabulary-for-the-11-plus": "what-this-app-does",
  "when-to-start-preparing": "when-to-start",
  "how-to-practise-effectively": "what-actually-helps",
  "managing-exam-anxiety": "the-case-against-over-preparation",
  "understanding-english-papers": "the-papers",
  "understanding-maths-papers": "the-papers",
  "verbal-and-non-verbal-reasoning": "the-papers",
  "tailoring-practice-to-your-child": "questions-parents-ask",
  "printable-vocabulary-sheets": "what-this-app-does",
};

export const dynamicParams = false;

export function generateStaticParams() {
  // Articles plus redirects: every servable slug, so nothing here 404s.
  // `managing-exam-pressure` is not in MOVED because it never was a redirect.
  return [...new Set([...Object.keys(ARTICLES), ...Object.keys(MOVED)])].map(
    (slug) => ({ slug }),
  );
}

function articleOf(slug: string): GuideArticle | null {
  return ARTICLES[slug] ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = articleOf(slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: `/guides/${slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      url: `/guides/${slug}`,
      images: ["/og-image.png"],
    },
  };
}

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = articleOf(slug);
  if (!article) redirect(`/info#${MOVED[slug] ?? "what-this-app-does"}`);
  return (
    <div className="site">
      <Header />
      <main className="workspace prose-workspace">
        <section className="page-hero">
          <div>
            <div className="eyebrow">A GUIDE FOR FAMILIES</div>
            <h1>{article.title}</h1>
            <p>{article.standfirst}</p>
            <p className="muted">Reviewed {dateLabel(article.reviewed)}.</p>
          </div>
        </section>
        <article className="prose-body">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
        <section aria-label="Sources">
          <h2>Sources</h2>
          <ul>
            {article.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source.title}
                </a>{" "}
                <span className="muted">{source.publisher}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="landing-cta no-print">
          <h2>Put it into practice.</h2>
          <p>
            A few minutes a day, free for 7 days. Start with the{" "}
            <Link href="/free-11-plus-vocabulary-words">
              free 100-word starter list
            </Link>
            .
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/practice">
              Try free practice
            </Link>
            <Link className="text-button" href="/how-to">
              How to use this
            </Link>
          </div>
        </section>
        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
