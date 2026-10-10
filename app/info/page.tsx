import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, List } from "lucide-react";
import Header from "@/components/minewords/header";
import { infoGroups, infoPage } from "@/lib/info/info";
import { PAGE_METADATA } from "@/lib/seo";

const page = infoPage();

export const metadata: Metadata = {
  // No site name at the end: the layout's title template appends "| MineWords".
  // This used to carry its own "| 11+ Vocabulary Challenge", so the rendered title
  // read "... | 11+ Vocabulary Challenge | MineWords" — two brand names and a pipe in
  // a search result.
  title: PAGE_METADATA.info.title,
  // Kept under 155 characters as a full sentence: the previous wording ran to
  // 208 and search results cut it off mid-word.
  description: PAGE_METADATA.info.description,
  // Without this the layout's `alternates.canonical: "/"` is inherited, which told a
  // search engine this page *was* the front page. Google would then have treated the
  // two as duplicates and kept one — most likely the front page, dropping this.
  alternates: { canonical: "/info" },
  // Page-level share tags, so a pasted link names this page rather than the
  // homepage. The layout's siteName, type and base URL still apply.
  openGraph: {
    title: PAGE_METADATA.info.title,
    description: PAGE_METADATA.info.description,
    images: ["/og-image.png"],
  },
};

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function InfoPage() {
  const groups = infoGroups();

  return (
    <div className="site">
      <Header />
      <main className="workspace info-workspace">
        <section className="info-hero">
          <div className="eyebrow">THE 11+ IN THE UK</div>
          <h1>
            Everything you need to know, in one place, with the sources shown.
          </h1>
          <p className="info-standfirst">{page.standfirst}</p>
          {page.sources.length > 0 && (
            <p className="info-updated">
              Checked against the exam providers, the Department for Education
              and the schools&rsquo; own admissions pages on{" "}
              {dateLabel(page.updated)}.
            </p>
          )}
        </section>

        <div className="info-layout">
          <nav className="info-contents" aria-label="Contents">
            <p className="info-contents-title">Contents</p>
            {groups.map((group) => (
              <div key={group.name} className="info-contents-group">
                <p className="info-contents-group-name">{group.name}</p>
                <ul>
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}>{section.heading}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <article className="info-body">
            {page.intro.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}

            {page.keyPoints.length > 0 && (
              <section
                className="info-key-points"
                aria-label="The short version"
              >
                <h2>The short version</h2>
                <ul>
                  {page.keyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
            )}

            {groups.map((group) => (
              <section
                key={group.name}
                className="info-group"
                aria-label={group.name}
              >
                <h2 className="info-group-name">{group.name}</h2>
                {group.sections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="info-section"
                  >
                    <h3>{section.heading}</h3>
                    {section.summary && (
                      <p className="info-section-summary">{section.summary}</p>
                    )}
                    {section.figures && section.figures.length > 0 && (
                      <dl className="info-figures">
                        {section.figures.map((figure) => (
                          <div key={figure.label}>
                            <dt>{figure.label}</dt>
                            <dd>{figure.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {section.body.map((paragraph) => (
                      <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                    ))}
                    {section.points && section.points.length > 0 && (
                      <ul>
                        {section.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                    {section.table && (
                      <div className="info-table-scroll">
                        <table className="info-table">
                          <thead>
                            <tr>
                              {section.table.head.map((cell) => (
                                <th key={cell} scope="col">
                                  {cell}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {section.table.rows.map((row) => (
                              <tr key={row.join("|")}>
                                {row.map((cell, index) => (
                                  <td key={`${row[0]}-${index}`}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {section.table.note && (
                          <p className="info-table-note">
                            {section.table.note}
                          </p>
                        )}
                      </div>
                    )}
                    {section.sources && section.sources.length > 0 && (
                      <details className="info-section-sources">
                        <summary>Sources for this section</summary>
                        <ul>
                          {section.sources.map((source) => (
                            <li key={source.url}>
                              <a
                                href={source.url}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                {source.title}{" "}
                                <ExternalLink size={13} aria-hidden />
                              </a>
                              <span>{source.publisher}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                ))}
              </section>
            ))}

            <section
              className="info-sources"
              aria-labelledby="info-sources-heading"
            >
              <h2 id="info-sources-heading">
                <List size={20} aria-hidden /> Every source on this page
              </h2>
              <p>
                Nothing on this page is written from memory. Each figure, name
                and date below was read from the page linked. If a source and
                this page disagree, the source is right.
              </p>
              <ul>
                {page.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {source.title} <ExternalLink size={13} aria-hidden />
                    </a>
                    <span>{source.publisher}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="info-cta" aria-label="Try the app">
              <h2>Reading about it is the easy part.</h2>
              <p>
                The part that actually moves a child forward is a few minutes a
                day, on words they have not met, with the difficulty matched to
                them and a record of what stuck. That is what this app does. It
                is free to start, and the account page says plainly what
                membership costs before you are asked for anything.
              </p>
              <div className="info-cta-links">
                <Link className="primary-button" href="/practice">
                  Start a free round
                </Link>
                <Link className="secondary-button" href="/account">
                  What membership costs
                </Link>
              </div>
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}
