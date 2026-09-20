"use client";
import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Stats } from "@/lib/challenge/types";
import { emptyPeriod, studyDuration } from "@/lib/challenge/rewards";
export default function ProgressPanel({
  stats,
  demo,
  liveSeconds = 0,
}: {
  stats: Stats;
  demo: boolean;
  liveSeconds?: number;
}) {
  const [period, setPeriod] = useState<"today" | "week" | "all">("today");
  const values = stats.periods?.[period] || {
    ...emptyPeriod(),
    correct: stats.correct,
    seconds: stats.totalSeconds,
  };
  const submitted = values.questions - values.reveals;
  const streak = stats.rewards?.streak || 0;
  return (
    <aside className="study-aside">
      <div className="progress-panel">
        <GraduationCap size={27} />
        <h3>Make every word yours.</h3>
        <p>Five correct answers across your chosen types master a word.</p>
        <div className="mastered">
          <strong>{stats.mastered}</strong>
          <span>words mastered</span>
        </div>
        <Progress
          aria-label="Words mastered"
          value={stats.total ? (stats.mastered / stats.total) * 100 : 0}
        />
        <div className="progress-label">
          {stats.mastered} of {stats.total} mastered · {stats.inProgress || 0}{" "}
          in progress
        </div>
        <div
          className="status-tabs"
          role="group"
          aria-label="Statistics period"
        >
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["all", "All time"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="status-date">
          {demo
            ? "This sample session only"
            : `${period === "all" ? "Since you started" : period === "week" ? `${stats.dates?.week || ""} – ${stats.dates?.today || ""}` : stats.dates?.today || ""} · London time`}
        </p>
        {(
          [
            ["Questions completed", values.questions],
            ["Correct answers", values.correct],
            [
              "Accuracy",
              submitted
                ? `${Math.round((values.correct / submitted) * 100)}%`
                : "—",
            ],
            ["New words explored", values.newWords],
            ["Words practised", values.words],
            ["Newly mastered", values.mastered],
            ["Study time", studyDuration(values.seconds)],
            ...(!demo ? [["Credits earned", values.credits]] : []),
          ] as [string, string | number][]
        ).map(([label, value]) => (
          <div className="stat-row" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
        <small>
          {liveSeconds > 0
            ? `+${studyDuration(liveSeconds)} active study, saving…`
            : "Time pauses when you leave or become inactive."}
        </small>
      </div>
      <div className="progress-panel reward-panel">
        <h3>{demo ? "Earn as you learn" : "Your learning credits"}</h3>
        {demo ? (
          <p>
            Sign in with a membership to earn saved credits and collect digital
            badges.
          </p>
        ) : (
          <>
            <div className="credit-balance">
              <strong>{stats.rewards?.balance || 0}</strong> credits available
            </div>
            <p>
              {streak} correct in a row · best {stats.rewards?.bestStreak || 0}
            </p>
            <div
              className="streak-markers"
              aria-label={`${streak % 3} of 3 towards a five-credit bonus`}
            >
              {[0, 1, 2].map((i) => (
                <span className={i < streak % 3 ? "filled" : ""} key={i}>
                  {i < streak % 3 ? "✓" : i + 1}
                </span>
              ))}
            </div>
            <p>
              {streak % 3} of 3 towards <strong>+5 bonus credits</strong>
            </p>
          </>
        )}
        <p className="status-date">
          +2 per correct answer · +5 every three in a row · +10 per mastered
          word
        </p>
        <a className="primary-button" href={demo ? "/account" : "/rewards"}>
          {demo ? "Save your progress" : "Badges & credit history"} →
        </a>
      </div>
    </aside>
  );
}
