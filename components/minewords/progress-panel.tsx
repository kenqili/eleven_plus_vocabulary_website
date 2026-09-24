"use client";
import { useState } from "react";
import { Flame, GraduationCap, Sparkles } from "lucide-react";
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
      <div className="progress-panel reward-panel">
        <div className="reward-heading">
          <span className="reward-icon"><Sparkles size={20} /></span>
          <div>
            <span className="dashboard-kicker">YOUR REWARDS</span>
            <h3>{demo ? "Learn and earn!" : "You’re on a roll!"}</h3>
          </div>
        </div>
        {demo ? (
          <p>Sign in to save your learning and collect credits and badges.</p>
        ) : (
          <>
            <div className="credit-balance">
              <strong>{stats.rewards?.balance || 0}</strong> credits
            </div>
            <div className="streak-summary">
              <Flame size={18} />
              <span><strong>{streak}</strong> correct in a row</span>
              <span className="streak-best">Best {stats.rewards?.bestStreak || 0}</span>
            </div>
            <div className="streak-markers" aria-label={`${streak % 3} of 3 towards a five-credit bonus`}>
              {[0, 1, 2].map((i) => (
                <span className={i < streak % 3 ? "filled" : ""} key={i}>
                  {i < streak % 3 ? "✓" : i + 1}
                </span>
              ))}
              <strong>3 in a row earns +5 bonus credits</strong>
            </div>
          </>
        )}
        <a className="rewards-link" href={demo ? "/account" : "/rewards"}>
          {demo ? "Save your progress" : "See badges & rewards"} →
        </a>
      </div>
      <div className="progress-panel">
        <div className="progress-heading">
          <GraduationCap size={21} />
          <h3>My word adventure</h3>
        </div>
        <div className="mastered">
          <strong>{stats.mastered}</strong>
          <span>words mastered</span>
        </div>
        <Progress
          aria-label="Words mastered"
          value={stats.total ? (stats.mastered / stats.total) * 100 : 0}
        />
        <div className="progress-label">
          {stats.mastered} of {stats.total} words mastered
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
        <div className="stat-grid">
          <div><strong>{values.questions}</strong><span>questions</span></div>
          <div><strong>{studyDuration(values.seconds + liveSeconds)}</strong><span>learning time</span></div>
          <div><strong>{submitted ? `${Math.round((values.correct / submitted) * 100)}%` : "—"}</strong><span>accuracy</span></div>
          <div><strong>{values.newWords}</strong><span>new words</span></div>
          <div><strong>{values.stories}</strong><span>stories read</span></div>
        </div>
        <p className="dashboard-note">
          {liveSeconds > 0
            ? "Your learning time is being saved."
            : "Five correct answers across your chosen types master a word."}
        </p>
      </div>
    </aside>
  );
}
