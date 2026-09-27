"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import Header from "./header";
import {
  CONTENT_LABELS,
  CONTENT_MODES,
  DENSITIES,
  bestDensityFor,
  type ContentMode,
} from "@/lib/challenge/print-layout";
import { WORD_FILTERS, type WordFilter } from "@/lib/challenge/word-summary";
import { DIFFICULTY_LEVELS, type DifficultyFilter } from "@/lib/challenge/difficulty";

export default function PrintSheetPage() {
  const [content, setContent] = useState<ContentMode>("meaning");
  const [layout, setLayout] = useState(() => bestDensityFor("meaning").id);
  const [filter, setFilter] = useState<WordFilter>("all");
  const [level, setLevel] = useState<DifficultyFilter>("all");
  const [search, setSearch] = useState("");

  const params = useMemo(() => {
    const query = new URLSearchParams({
      format: "sheet",
      filter,
      level: String(level),
      layout,
      content,
    });
    if (search.trim()) query.set("search", search.trim());
    return query;
  }, [filter, level, layout, content, search]);

  const changeContent = (mode: ContentMode) => {
    setContent(mode);
    setLayout(bestDensityFor(mode).id);
  };

  return (
    <div className="site">
      <Header />
      <main className="workspace prose-workspace">
        <section className="page-hero">
          <div>
            <div className="eyebrow">PRINTABLE WORD SHEETS</div>
            <h1>Print a sheet that fits your page.</h1>
            <p>
              Choose how much to show on each word and how tightly to pack the
              page. The sheet is laid out for A4, so printing or saving it as a
              PDF gives one clean grid per page.
            </p>
          </div>
        </section>

        <section className="manage-section">
          <h2>
            <Printer size={20} aria-hidden /> What to show
          </h2>
          <div className="sheet-options" role="group" aria-label="What to show on each word">
            {CONTENT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="sheet-option"
                aria-pressed={content === mode}
                onClick={() => changeContent(mode)}
              >
                {CONTENT_LABELS[mode]}
              </button>
            ))}
          </div>
        </section>

        <section className="manage-section">
          <h2>Words per page</h2>
          <div className="sheet-options" role="group" aria-label="Words per page">
            {DENSITIES.map((entry) => {
              const fits =
                CONTENT_MODES.indexOf(content) <=
                CONTENT_MODES.indexOf(entry.maxContent);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="sheet-option"
                  aria-pressed={layout === entry.id}
                  disabled={!fits}
                  title={
                    fits
                      ? `${entry.columns} across, ${entry.rows} down`
                      : `Too tight for ${CONTENT_LABELS[content].toLowerCase()}`
                  }
                  onClick={() => setLayout(entry.id)}
                >
                  <strong>{entry.label}</strong>
                  <small>
                    {entry.cellWidthMm} × {entry.cellHeightMm} mm per word
                  </small>
                </button>
              );
            })}
          </div>
          <p className="manage-hint">
            Only the grids that can show this much text are offered, so nothing
            ever prints too small to read.
          </p>
        </section>

        <section className="manage-section">
          <h2>Which words</h2>
          <div className="sheet-filters">
            <label htmlFor="sheet-filter">Progress</label>
            <select
              id="sheet-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as WordFilter)}
            >
              {Object.entries(WORD_FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="sheet-level">Level</label>
            <select
              id="sheet-level"
              value={level}
              onChange={(event) =>
                setLevel(event.target.value as DifficultyFilter)
              }
            >
              <option value="all">All levels</option>
              {Object.entries(DIFFICULTY_LEVELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="sheet-search">Search</label>
            <input
              id="sheet-search"
              maxLength={60}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </section>

        <div className="sheet-actions">
          <a
            className="primary-button"
            href={`/api/words/export?${params.toString()}`}
            target="_blank"
            rel="noreferrer"
          >
            <Printer size={17} aria-hidden /> Open the printable sheet
          </a>
          <Link className="manage-action" href="/words">
            Back to the word list
          </Link>
        </div>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
