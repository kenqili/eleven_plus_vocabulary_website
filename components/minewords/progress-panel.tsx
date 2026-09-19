import { Check, GraduationCap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Stats } from "@/lib/challenge/types";
import { MASTERY_TARGET } from "@/lib/challenge/config";
export default function ProgressPanel({
  stats,
  demo,
}: {
  stats: Stats;
  demo: boolean;
}) {
  return (
    <aside className="study-aside">
      <div className="progress-panel">
        <GraduationCap size={27} />
        <h3>Make every word yours.</h3>
        <p>
          Answer a word correctly {MASTERY_TARGET} times across your chosen
          question types to master it.
        </p>
        <div className="mastered">
          <strong>{stats.mastered}</strong>
          <span>words mastered</span>
        </div>
        <Progress
          aria-label="Words mastered"
          value={stats.total ? (stats.mastered / stats.total) * 100 : 0}
        />
        <div className="progress-label">
          {stats.total
            ? `${stats.mastered} of ${stats.total} words mastered`
            : "Loading your word collection…"}
        </div>
        <div className="stat-row">
          <span>Correct answers</span>
          <b>{stats.correct}</b>
        </div>
        <div className="stat-row">
          <span>Practice today (UTC)</span>
          <b>{Math.floor(stats.todaySeconds / 60)} min</b>
        </div>
        <div className="stat-row">
          <span>Total practice</span>
          <b>{Math.floor(stats.totalSeconds / 60)} min</b>
        </div>
      </div>
      <div className="tip">
        <Check size={20} />
        <p>
          {demo
            ? "Try five words. A membership saves your progress and opens the full vocabulary library."
            : "Take your time. Words you miss will come back for another try."}
        </p>
      </div>
      {demo && (
        <a className="text-button" href="/account">
          Explore membership →
        </a>
      )}
    </aside>
  );
}
