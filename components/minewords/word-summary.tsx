"use client";
import Pronunciation from "./pronunciation";
import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";
import {
  DIFFICULTY_LEVELS,
  type DifficultyFilter,
} from "@/lib/challenge/difficulty";
import {
  CUMULATIVE_FLOOR,
  describeRecallTargets,
  runTarget,
} from "@/lib/challenge/mastery";
import {
  filterWords,
  WORD_FILTERS,
  LEARNING_STATUS,
  type WordFilter,
  type WordSummaryData,
} from "@/lib/challenge/word-summary";
const pageSize = 40;
export default function WordSummaryPage() {
  const [data, setData] = useState<WordSummaryData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<WordFilter>("all");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api<WordSummaryData>("/api/words")
        .then((result) => {
          if (active) {
            setData(result);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (active) {
            setError(e.message);
            setData(null);
          }
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const matching = filterWords(data?.words || [], filter, search, difficulty);
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = matching.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const exportParams = new URLSearchParams({
    filter,
    search,
    level: String(difficulty),
  });
  async function download() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/words/export?${exportParams}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || "Unable to export words.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `minewords-${filter}-level-${difficulty}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <Header />
      <main className="workspace words-workspace">
        <Link className="text-button" href="/">
          ← Back to practice
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR WORD COLLECTION</div>
            <h1>A little practice. Lasting progress.</h1>
            <p className="muted">
              See how each word is going, then make a revision sheet to learn
              away from the screen.
            </p>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error} {!data && <Link href="/account">Go to your account →</Link>}
          </p>
        )}
        {!data && !error && <p role="status">Loading your words…</p>}
        {data && (
          <>
            <div className="word-levels" aria-label="Learning progress">
              {Object.entries(LEARNING_STATUS).map(([level, label]) => (
                <button
                  key={level}
                  className={`word-level-card level-${level}`}
                  aria-pressed={filter === level}
                  onClick={() => {
                    setFilter(level as WordFilter);
                    setPage(0);
                  }}
                >
                  <strong>
                    {data.words.filter((word) => word.status === level).length}
                  </strong>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <p className="muted word-level-help">
              {describeRecallTargets()} master a word, as do {runTarget(0)}–{runTarget(5)}{" "}
              right answers in a row or {CUMULATIVE_FLOOR} right answers whenever
              they come. Needs practice highlights unmastered words with a mistake
              or revealed answer.
            </p>
            <section
              className="word-tools"
              aria-label="Filter and export words"
            >
              <div className="difficulty-filter">
                <label htmlFor="word-difficulty">Difficulty level</label>
                <select
                  id="word-difficulty"
                  value={difficulty}
                  onChange={(event) => {
                    setDifficulty(
                      event.target.value === "all"
                        ? "all"
                        : (Number(event.target.value) as DifficultyFilter),
                    );
                    setPage(0);
                  }}
                >
                  <option value="all">All levels</option>
                  {Object.entries(DIFFICULTY_LEVELS).map(([number, label]) => (
                    <option key={number} value={number}>
                      {label} (
                      {
                        data.words.filter(
                          (word) => word.difficulty === Number(number),
                        ).length
                      }{" "}
                      words)
                    </option>
                  ))}
                </select>
                <details className="difficulty-help">
                  <summary>How are levels assigned?</summary>
                  <p>
                    Level 0 holds the curriculum extension words. Level 1
                    contains the easier words in this collection; Level 5 the
                    more challenging. For Levels 1–5 we combine 70% word rarity
                    with 30% letter count, then divide those words into five
                    equal bands, so the original levels keep their words. These
                    are estimates, not exam grades. Short rare words can still
                    have a high level.
                  </p>
                  <p>
                    Frequency data:{" "}
                    <a
                      href="https://github.com/rspeer/wordfreq"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      wordfreq 3.1.1 by Robyn Speer
                    </a>
                    , including freely available SUBTLEX by Marc Brysbaert and
                    colleagues. Derived levels use{" "}
                    <a
                      href="https://creativecommons.org/licenses/by-sa/4.0/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      CC BY-SA 4.0
                    </a>
                    . Phrase frequencies are estimates; three words with no
                    frequency entry are treated as rare.
                  </p>
                </details>
              </div>
              <label htmlFor="word-search">Find a word or definition</label>
              <input
                id="word-search"
                type="search"
                maxLength={200}
                placeholder="Search your word collection…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
              <div className="word-filters" aria-label="Quick filters">
                {Object.entries(WORD_FILTERS).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => {
                      setFilter(key as WordFilter);
                      setPage(0);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="word-export-row">
                {data.trial && (
                  <span className="trial-export-note" role="status">
                    {data.trialDaysRemaining}{" "}
                    {data.trialDaysRemaining === 1 ? "day" : "days"} left in
                    your free trial. Full word exports are included.
                  </span>
                )}
                <p role="status">
                  <strong>{matching.length}</strong> of {data.words.length}{" "}
                  words
                  {filter === "mistakes" || filter === "revealed"
                    ? " · includes previously mastered words"
                    : ""}
                </p>
                {data.premium ? (
                  <div className="control-row">
                    <button
                      className="primary-button"
                      disabled={!matching.length || exporting}
                      onClick={() => void download()}
                    >
                      {exporting
                        ? "Exporting…"
                        : `Export CSV (${matching.length})`}
                    </button>
                    {matching.length > 0 && (
                      <a
                        className="secondary-button"
                        href={`/api/words/export?${exportParams}&format=print`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Print / Save PDF ({matching.length}) ↗
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="muted">
                    <Link className="text-button" href="/account">
                      Get premium
                    </Link>{" "}
                    to export or print your revision sheet.
                  </p>
                )}
              </div>
              <p className="muted">
                Exports include every matching word, its meaning, examples and
                progress. Choose Needs practice for a focused revision sheet.
              </p>
            </section>
            {matching.length === 0 ? (
              <section className="history-panel">
                <h2>No words match this view.</h2>
                <p>
                  Try another filter or clear your search. Mistakes and revealed
                  answers appear here as you practise.
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                    setDifficulty("all");
                    setPage(0);
                  }}
                >
                  Show all words
                </button>
              </section>
            ) : (
              <>
                <div className="word-table-wrap">
                  <table className="word-table">
                    <caption className="sr-only">
                      Word meanings and your saved learning progress
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Word & meaning</th>
                        <th scope="col">Difficulty</th>
                        <th scope="col">Learning status</th>
                        <th scope="col">Progress</th>
                        <th scope="col">Practice history</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((word) => (
                        <tr key={word.id}>
                          <td>
                            <strong className="summary-word">
                              {word.word}
                            </strong>
                            <Pronunciation word={word.word} id={word.id} />
                            <p>{word.definition}</p>
                            <details>
                              <summary>Example & related words</summary>
                              {word.example && (
                                <p>
                                  <em>{word.example}</em>
                                </p>
                              )}
                              <p>
                                <b>Synonyms:</b> {word.syn || "—"}
                                <br />
                                <b>Antonyms:</b> {word.ant || "—"}
                              </p>
                            </details>
                          </td>
                          <td>
                            <span className="difficulty-tag">
                              {DIFFICULTY_LEVELS[word.difficulty]}
                            </span>
                            <small>{word.letterCount} letters</small>
                            <small>
                              {word.frequencyKind === "unavailable"
                                ? "Frequency unavailable"
                                : `Frequency: ${word.frequencyZipf.toFixed(2)} Zipf${word.frequencyKind === "phrase-estimate" ? " (phrase estimate)" : ""}`}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`word-level-tag level-${word.status}`}
                            >
                              {LEARNING_STATUS[word.status]}
                            </span>
                          </td>
                          <td>
                            <label className="word-progress-label">
                              <span>
                                {word.correct} correct{word.status === "mastered" ? " · mastered" : ""}
                              </span>
                              <progress
                                value={word.status === "mastered" ? CUMULATIVE_FLOOR : word.correct}
                                max={CUMULATIVE_FLOOR}
                                aria-label={`${word.word}: ${word.correct} correct, ${LEARNING_STATUS[word.status]}`}
                              />
                            </label>
                          </td>
                          <td>
                            <span>
                              {word.mistakes} mistakes · {word.reveals} reveals
                            </span>
                            <small>{word.seen} times shown</small>
                            <small>
                              {word.lastPractised
                                ? `Last answered ${new Date(word.lastPractised).toLocaleDateString("en-GB")}`
                                : "No answers yet"}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <nav className="word-pagination" aria-label="Word list pages">
                  <button
                    className="secondary-button"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentPage + 1} of {pages}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={currentPage + 1 >= pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </button>
                </nav>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
