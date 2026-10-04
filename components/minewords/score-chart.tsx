"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Point = { day: string; score: number };
type PlacementResponse = {
  level: number;
  score: number;
  history: Point[];
};

/**
 * The child's score over time, as a line.
 *
 * One point per day a word was first mastered. Horizontal lines mark where
 * each level starts (each sixth of 10,000), so a child can see both the climb
 * within a level and the crossing into the next.
 *
 * Data arrives two ways: `LevelProgress` above fetches once and hands it down
 * (one request for bar and chart together), otherwise the chart fetches on its
 * own `refreshKey` — the practice page passes the mastered count, so the line
 * extends the moment a word is mastered rather than on the next visit.
 *
 * Rendered only with two or more points: a single dot is not a line, and the
 * badge on the question already says where the child is today.
 */
export default function ScoreChart({
  refreshKey,
  data: provided,
}: {
  refreshKey: number;
  data?: PlacementResponse | null;
}) {
  const [fetched, setFetched] = useState<PlacementResponse | null>(null);
  useEffect(() => {
    if (provided !== undefined) return;
    let cancelled = false;
    void api<PlacementResponse>("/api/placement")
      .then((response) => {
        if (!cancelled) setFetched(response);
      })
      .catch(() => {
        // A missing chart must never break practice: the badge on the question
        // already carries today's number, so this fails by staying absent.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, provided]);
  const data = provided ?? fetched;

  if (!data || data.history.length < 2) return null;
  const points = data.history;
  const width = 560;
  const height = 180;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const first = Date.parse(`${points[0].day}T12:00:00Z`);
  const last = Date.parse(`${points[points.length - 1].day}T12:00:00Z`);
  const span = Math.max(1, last - first);
  const x = (day: string) =>
    padLeft + ((Date.parse(`${day}T12:00:00Z`) - first) / span) * innerWidth;
  const y = (score: number) =>
    padTop +
    innerHeight -
    (Math.max(0, Math.min(10000, score)) / 10000) * innerHeight;
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(point.day).toFixed(1)},${y(point.score).toFixed(1)}`,
    )
    .join(" ");
  const formatDay = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return `${date}/${month}/${String(year).slice(2)}`;
  };
  const summary = `Score ${data.history[0].score.toLocaleString("en-GB")} on ${formatDay(points[0].day)}, now ${data.score.toLocaleString("en-GB")}. Level ${data.level}.`;
  return (
    <figure
      className="score-chart"
      role="img"
      aria-label={`Score over time. ${summary}`}
    >
      <title>Your score is growing</title>
      <svg viewBox={`0 0 ${width} ${height}`} className="score-chart-svg">
        {[1, 2, 3, 4, 5].map((band) => {
          const lineY = y((band / 6) * 10000);
          return (
            <g key={band}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={lineY}
                y2={lineY}
                className="score-chart-grid"
              />
              <text x={padLeft - 6} y={lineY + 4} className="score-chart-band">
                L{band}
              </text>
            </g>
          );
        })}
        <path d={line} className="score-chart-line" fill="none" />
        {points.map((point) => (
          <circle
            key={point.day}
            cx={x(point.day)}
            cy={y(point.score)}
            r={3.5}
            className="score-chart-dot"
          >
            <title>{`${formatDay(point.day)}: ${point.score.toLocaleString("en-GB")}`}</title>
          </circle>
        ))}
        <text x={padLeft} y={height - 6} className="score-chart-day">
          {formatDay(points[0].day)}
        </text>
        <text
          x={width - padRight}
          y={height - 6}
          textAnchor="end"
          className="score-chart-day"
        >
          {formatDay(points[points.length - 1].day)}
        </text>
      </svg>
      <figcaption className="muted">
        Your score over time — {summary}
      </figcaption>
    </figure>
  );
}
