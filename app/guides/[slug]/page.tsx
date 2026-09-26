import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink } from "lucide-react";
import Header from "@/components/minewords/header";
import { guideArticle, guideSlugs } from "@/lib/guides/articles";

export function generateStaticParams() {
  return guideSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = guideArticle(slug);
  if (!article) return { title: "Guide not found" };
  return {
    title: `${article.title} | 11+ Vocabulary Challenge`,
    description: article.summary,
  };
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = guideArticle(slug);
  if (!article) notFound();

  return (
    <div className="site">
      <Header />
      <main className="workspace guides-workspace">
        <article className="guide-article">
          <Link className="guide-back" href="/guides">
            <ArrowLeft size={15} aria-hidden /> All guides
          </Link>
          <div className="guide-card-tags">
            {article.tags.map((tag) => (
              <span key={tag} className="guide-chip">
                {tag}
              </span>
            ))}
          </div>
          <h1>{article.title}</h1>
          <p className="guide-standfirst">{article.summary}</p>
          <span className="guide-card-meta">
            <Clock size={15} aria-hidden /> {article.readMinutes} min read
          </span>

          {article.keyPoints.length > 0 && (
            <section className="guide-key-points" aria-label="Key points">
              <h2>Worth knowing</h2>
              <ul>
                {article.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          )}

          {article.sections.map((section) => (
            <section key={section.heading} className="guide-section">
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </section>
          ))}

          <section className="guide-sources">
            <h2>Sources</h2>
            <ul>
              {article.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noreferrer noopener" target="_blank">
                    {source.title} <ExternalLink size={13} aria-hidden />
                  </a>
                  <span>{source.publisher}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
