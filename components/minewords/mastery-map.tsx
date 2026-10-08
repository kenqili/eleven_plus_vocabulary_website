"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";
import { DIFFICULTY_LEVELS } from "@/lib/challenge/difficulty";
import type { WordSummaryData } from "@/lib/challenge/word-summary";

/**
 * The mastery map: one block per word per level, darker as it gets closer
 * to mastered.
 *
 * This used to live on the word list itself, where six levels of blocks
 * pushed the list it was summarising far down the page. It has its own page
 * now, linked from there. Cells are fixed positions in collection order, so
 * the map fills in rather than reshuffling as the child learns. Counts come
 * from the tallies, not the cells, so the words never depend on the
 * rendering. Only two kilobytes cross the wire for the whole collection: one
 * status character per word.
 */
export default function MasteryMap() {
  const [heatmap, setHeatmap] = useState<Record<string, string>>({});
  const [levelCounts, setLevelCounts] = useState<
    Record<string, Record<string, number>>
  >({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // One row is enough: the map reads the tallies, and the tallies cover
    // the whole collection whatever the page holds.
    void api<WordSummaryData>(
      "/api/words?filter=all&level=all&search=&offset=0&limit=1",
    )
      .then((result) => {
        setHeatmap(result.heatmap ?? {});
        setLevelCounts(result.levelCounts ?? {});
        setLoaded(true);
        setError("");
      })
      .catch((e: Error) => {
        setError(e.message);
      });
  }, []);
  const fmt = (n: number) => n.toLocaleString("en-GB");
  return (
    <>
      <Header />
      <main className="workspace words-workspace">
        <Link className="text-button" href="/words">
          ← Back to the word list
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR WORD COLLECTION</div>
            <h1>Mastery map</h1>
            <p className="muted">
              One block per word. Darker blocks are closer to mastered.
            </p>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error} <Link href="/account">Go to your account →</Link>
          </p>
        )}
        {!loaded && !error && <p role="status">Loading your map…</p>}
        {loaded && (
          <section
            className="word-heatmap"
            aria-label="Mastery map: darker blocks are closer to mastered"
          >
            <div className="word-heatmap-legend">
              <span>
                <i className="word-cell word-cell-mastered" aria-hidden="true" />
                Mastered
              </span>
              <span>
                <i className="word-cell word-cell-learning" aria-hidden="true" />
                Learning
              </span>
              <span>
                <i className="word-cell word-cell-new" aria-hidden="true" />
                New
              </span>
            </div>
            {[0, 1, 2, 3, 4, 5].map((band) => {
              const cells = heatmap[String(band)] ?? "";
              const tally = levelCounts[String(band)] ?? {};
              const mastered = tally.mastered ?? 0;
              const learning =
                (tally.learning ?? 0) + (tally.practice ?? 0);
              const fresh = tally.new ?? 0;
              return (
                <div
                  key={band}
                  className="word-heatmap-row"
                  role="img"
                  aria-label={`${DIFFICULTY_LEVELS[band as keyof typeof DIFFICULTY_LEVELS]}: ${fmt(mastered)} mastered, ${fmt(learning)} learning, ${fmt(fresh)} new`}
                >
                  <span className="word-heatmap-level">
                    {DIFFICULTY_LEVELS[band as keyof typeof DIFFICULTY_LEVELS]}
                  </span>
                  <div className="word-heatmap-cells" aria-hidden="true">
                    {cells.split("").map((cell, index) => (
                      <i
                        key={index}
                        className={`word-cell word-cell-${
                          cell === "m"
                            ? "mastered"
                            : cell === "l"
                              ? "learning"
                              : "new"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </>
  );
}
