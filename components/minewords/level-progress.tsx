"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import ScoreChart from "./score-chart";

export type PlacementData = {
  level: number;
  score: number;
  history: Array<{ day: string; score: number }>;
};

/**
 * How far to 10,000, as a horizontal bar — plus the score-over-time chart.
 *
 * One fetch serves both: the bar needs today's level and score, the chart
 * needs the history, and `/api/placement` returns all three together.
 * Refreshes when `refreshKey` changes (the practice page passes the mastered
 * count, so both move the moment a word is mastered).
 *
 * The fill blends green → yellow → red as it grows: at low scores only green
 * shows, yellow arrives around the middle, red near the top. Ticks mark where
 * each level starts (every sixth of 10,000), so a child sees both the next
 * milestone and the final one.
 */
export default function LevelProgress({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<PlacementData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<PlacementData>("/api/placement")
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        // Practice works without it: the question badge already carries
        // today's number, so this fails by staying absent.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data) return null;
  const clamped = Math.max(0, Math.min(10000, data.score));
  const pct = (clamped / 10000) * 100;
  return (
    <div className="level-progress">
      <div className="level-progress-top">
        <strong>Level {data.level}</strong>
        <span className="muted">
          {data.score.toLocaleString("en-GB")} / 10,000
        </span>
      </div>
      <div
        className="level-progress-track"
        role="progressbar"
        aria-valuenow={data.score}
        aria-valuemin={0}
        aria-valuemax={10000}
        aria-label={`Level ${data.level}, score ${data.score.toLocaleString("en-GB")} out of 10,000`}
      >
        <div className="level-progress-fill" style={{ width: `${pct}%` }} />
        {[1, 2, 3, 4, 5].map((band) => (
          <span
            key={band}
            className="level-progress-tick"
            style={{ left: `${(band / 6) * 100}%` }}
            title={`Level ${band} starts at ${Math.round((band / 6) * 10000).toLocaleString("en-GB")}`}
          />
        ))}
      </div>
      <ScoreChart refreshKey={refreshKey} data={data} />
    </div>
  );
}
