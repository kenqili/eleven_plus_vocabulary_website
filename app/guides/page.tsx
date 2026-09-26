import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import Header from "@/components/minewords/header";
import { guideArticles, guideTags } from "@/lib/guides/articles";

export const metadata: Metadata = {
  title: "11+ preparation guides | 11+ Vocabulary Challenge",
  description:
    "Plain-English guides to UK 11+ preparation: which tests exist, what each paper tests, how to build vocabulary, when to start, how to practise and how to manage pressure.",
};

export default function GuidesPage() {
  const articles = guideArticles();
  const tags = guideTags();
  return (
    <div className="site">
      <Header />
      <main className="workspace guides-workspace">
        <section className="guides-hero">
          <div>
            <div className="eyebrow">11+ PREPARATION, EXPLAINED</div>
            <h1>Guides for parents who want to prepare calmly.</h1>
            <p>
              There is a lot of noisy advice about the 11+. These guides stick to
              what the exam providers, the education watchdog and the reading
              research actually say, and every claim links back to its source.
              Start wherever your question is.
            </p>
          </div>
        </section>

        <nav className="guide-tags" aria-label="Guide topics">
          {tags.map((tag) => (
            <a key={tag} className="guide-tag" href={`#${tag}`}>
              {tag}
            </a>
          ))}
        </nav>

        <ul className="guide-list">
          {articles.map((article) => (
            <li key={article.slug} className="guide-card" id={article.tags[0]}>
              <div className="guide-card-tags">
                {article.tags.map((tag) => (
                  <span key={tag} className="guide-chip">
                    {tag}
                  </span>
                ))}
              </div>
              <h2>
                <Link href={`/guides/${article.slug}`}>{article.title}</Link>
              </h2>
              <p>{article.summary}</p>
              <span className="guide-card-meta">
                <Clock size={15} aria-hidden /> {article.readMinutes} min read
              </span>
              <Link
                className="guide-card-link"
                href={`/guides/${article.slug}`}
              >
                Read the guide <ArrowRight size={15} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>

        <p className="howto-note">
          These guides are general study advice. They are not affiliated with any
          exam board or school, and nothing here guarantees coverage of the
          papers your child will actually sit. Check your own school and local
          authority for the current arrangements, because they change.
        </p>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
