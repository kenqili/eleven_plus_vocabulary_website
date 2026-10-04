"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { BumpingNumber } from "./bumping-number";

export type PlacementData = {
  level: number;
  score: number;
};

/**
 * How far to 10,000, as a horizontal bar with the score on it.
 *
 * The bar is live: `liveLevel`/`liveScore` come from the browser engine on the
 * same frame an answer is graded, so the number ticks the moment a word is
 * mastered. `/api/placement` is the fallback before the engine has answered,
 * and the refresh when `refreshKey` changes (the practice page passes the
 * mastered count).
 *
 * The fill shows the first slice of the full 0–10,000 gradient, not the whole
 * gradient squeezed into the fill: at low scores only green shows, yellow
 * arrives around the middle, red near the top. Ticks mark where each level
 * starts (every sixth of 10,000), and the chip riding the tip carries the
 * score itself — the number that moves as the child studies.
 */
export default function LevelProgress({
  refreshKey,
  liveLevel,
  liveScore,
}: {
  refreshKey: number;
  liveLevel?: number | null;
  liveScore?: number | null;
}) {
  const [data, setData] = useState<PlacementData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<PlacementData>("/api/placement")
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        // Practice works without it: the live number below already carries
        // today's score, so this fails by staying absent.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const level = liveLevel ?? data?.level;
  const score = liveScore ?? data?.score;
  if (level == null || score == null) return null;
  const clamped = Math.max(0, Math.min(10000, score));
  const pct = (clamped / 10000) * 100;
  return (
    <div className="level-progress">
      <div className="level-progress-top">
        <strong>Level {level}</strong>
        <span className="muted level-progress-score">
          <BumpingNumber
            value={score}
            format={(n) => n.toLocaleString("en-GB")}
          />{" "}
          / 10,000
        </span>
      </div>
      <div className="level-progress-bar">
        <div
          className="level-progress-track"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={10000}
          aria-label={`Level ${level}, score ${score.toLocaleString("en-GB")} out of 10,000`}
        >
          <div
            className="level-progress-fill"
            style={{
              width: `${pct}%`,
              // Scale the gradient to the whole track, so the fill shows only
              // the first pct% of the green→red run rather than the whole run
              // squeezed into itself. No repeat, or the red end tiles back in.
              backgroundSize: pct > 0 ? `${(100 / pct) * 100}% 100%` : undefined,
              backgroundRepeat: "no-repeat",
            }}
          />
          {[1, 2, 3, 4, 5].map((band) => (
            <span
              key={band}
              className="level-progress-tick"
              style={{ left: `${(band / 6) * 100}%` }}
              title={`Level ${band} starts at ${Math.round((band / 6) * 10000).toLocaleString("en-GB")}`}
            />
          ))}
        </div>
        {/*
          The score on the bar. Hidden from assistive tech on purpose: the
          track above already announces "Level N, score X out of 10,000", so
          reading this too would say the score twice.
        */}
        <span
          className="level-progress-marker"
          aria-hidden="true"
          title={`Score ${score.toLocaleString("en-GB")} out of 10,000`}
          style={{
            left: `clamp(42px, ${pct}%, calc(100% - 42px))`,
          }}
        >
          {score.toLocaleString("en-GB")}
        </span>
      </div>
    </div>
  );
}
