"use client";

import { useState, type CSSProperties } from "react";
import {
  Brain,
  Compass,
  Flame,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { coachLine, type CoachContext, type CoachMoment } from "@/lib/challenge/coach";
import type { Feedback } from "@/lib/challenge/types";

/**
 * The moment, and how it looks.
 *
 * A child should be able to tell what kind of moment this is without reading
 * it, because at nine the words are slower than the recognition. So the mark
 * and the colour are chosen with the words rather than after them, and each
 * moment is a different kind of thing rather than a different shade of one thing.
 *
 * The animation is CSS rather than a library, because that is what the rest of
 * the app does and a dependency for one spring would be a poor trade. The global
 * prefers-reduced-motion rule at the top of the stylesheet already reduces every
 * duration here to nothing, so nothing further is needed for a child who has
 * asked their device for stillness.
 */
const MOMENTS: Record<
  CoachMoment,
  { icon: typeof Trophy; label: string; celebration: boolean }
> = {
  mastered: { icon: Trophy, label: "Word finished", celebration: true },
  streak: { icon: Flame, label: "A run going", celebration: true },
  "first-meeting": { icon: Sparkles, label: "New word", celebration: false },
  returning: { icon: Compass, label: "Back again", celebration: false },
  "hard-won": { icon: Target, label: "Got there", celebration: true },
  "clean-recall": { icon: Brain, label: "Straight out", celebration: false },
  assisted: { icon: Brain, label: "Used a clue", celebration: false },
  steady: { icon: TrendingUp, label: "Right", celebration: false },
  missed: { icon: Compass, label: "Back in the list", celebration: false },
  revealed: { icon: Compass, label: "Shown", celebration: false },
};

/** Eight directions, for the burst. Precomputed so the render stays trivial. */
const BURST_TICKS = [0, 45, 90, 135, 180, 225, 270, 315];

export function CoachNote({
  feedback,
  streak,
  word,
  seen,
  correctCount,
  difficulty,
}: {
  feedback: Feedback;
  streak: number;
  word: string;
  seen: number;
  correctCount: number;
  difficulty?: number;
}) {
  /**
   * The seed of the answer shown before this one, so two answers in a row never
   * draw the same sentence. A fifth of random draws collide, and a repeated
   * sentence reads as a stuck app rather than a coincidence.
   *
   * This is the render-phase state update React documents for exactly this: a
   * ref during render is unsafe under concurrent rendering, and setting state
   * in an effect causes a cascading render. Here React throws the in-progress
   * render away and starts again, so the child never sees the intermediate
   * value, and the only cost is one discarded render.
   *
   * The current answer's seed is its attempt id, which is unique and stable, so
   * a re-render of the same answer cannot shift the line under the child's feet.
   */
  const [shown, setShown] = useState<{ current: string; previous?: string }>({
    current: "",
  });
  const answerId = feedback.attemptId || word;
  if (shown.current !== answerId)
    setShown({ current: answerId, previous: shown.current || undefined });
  const previousSeed = shown.current === answerId ? shown.previous : undefined;

  const line = coachLine({
    word,
    correct: feedback.correct,
    // A clue is an honest admission of uncertainty, and the wording says so
    // rather than congratulating a child on a right answer they were helped
    // into. Being helped is fine; being told you knew it when you did not is the
    // thing that costs trust.
    assisted: feedback.evidence === "assisted",
    recalled: feedback.evidence === "recalled",
    mastered: !!feedback.newlyMastered,
    seen,
    correctCount,
    difficulty,
    streak,
    daysSince: feedback.daysSince,
    seed: answerId,
    previousSeed,
  } as CoachContext);

  const { icon: Icon, label, celebration } = MOMENTS[line.moment];

  return (
    <div
      className={`coach coach-${line.moment}${celebration ? " coach-celebrate" : ""}`}
      // The key changes with the answer, which is what makes the entrance
      // animation replay per question instead of only on the first one.
      key={answerId}
    >
      <span className="coach-mark" aria-hidden>
        <Icon size={20} />
      </span>
      <div className="coach-body">
        <span className="coach-label">{label}</span>
        <p className="coach-line">{line.text}</p>
        {line.detail && <p className="coach-detail">{line.detail}</p>}
      </div>
      {celebration && (
        <div className="coach-burst" aria-hidden>
          {BURST_TICKS.map((angle) => (
            <span
              key={angle}
              style={{ "--tick-rotation": `${angle}deg` } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
