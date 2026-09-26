"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Stats } from "@/lib/challenge/types";
import {
  DAILY_QUESTION_TARGET,
  missionMessage,
  missionProgress,
  type Mission,
} from "@/lib/challenge/mission";
export default function DailyMission({
  stats,
  signedIn,
  refreshKey = "",
}: {
  stats?: Pick<Stats, "mission">;
  signedIn: boolean;
  refreshKey?: string | number;
}) {
  const [saved, setSaved] = useState<Mission | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let active = true,
      sequence = 0;
    const refresh = () => {
      if (document.hidden) return;
      const request = ++sequence;
      void api<{ mission: Mission | null }>("/api/mission")
        .then((result) => {
          if (active && request === sequence) {
            setSaved(result.mission);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active && request === sequence) setFailed(true);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn, refreshKey]);
  let current = stats?.mission ?? saved;
  if (saved && current) {
    current =
      saved.day > current.day
        ? saved
        : saved.day === current.day
          ? {
              day: current.day,
              questions: Math.max(current.questions, saved.questions),
              stories: Math.max(current.stories, saved.stories),
            }
          : current;
  }
  const progress = missionProgress(
    signedIn && current ? current : { day: "", questions: 0, stories: 0 },
  );
  return (
    <section className="daily-mission" aria-label="Daily adventure">
      <div>
        <strong>
          {progress.complete
            ? "Today’s adventure complete!"
            : signedIn
              ? "Today’s little adventure"
              : "Your first little adventure"}
        </strong>
        <p role="status">{missionMessage({ day: "", ...progress })}</p>
      </div>
      {signedIn && !current ? (
        <p role="status">
          {failed
            ? "Your mission progress could not load. It will try again shortly."
            : "Finding your progress…"}
        </p>
      ) : (
        <>
          <div className="mission-steps">
            <Link
              href="/"
              aria-label={`${progress.questions} of ${DAILY_QUESTION_TARGET} questions tried. Go to practice.`}
            >
              {progress.questions === DAILY_QUESTION_TARGET ? "✓ " : ""}
              {progress.questions}/{DAILY_QUESTION_TARGET} questions tried
            </Link>
            <Link
              href="/stories"
              aria-label={`${progress.stories} of 1 stories completed. Choose a story.`}
            >
              {progress.stories === 1 ? "✓ " : ""}
              {progress.stories}/1 story finished
            </Link>
          </div>
          {signedIn ? (
            <small>
              {current?.day} · Resets at midnight in London. Try an answer to
              move your mission along. Rereads count too.
            </small>
          ) : (
            <small>
              <Link href="/account">Sign in</Link> to save your daily mission
              and earn credits.
            </small>
          )}
        </>
      )}
    </section>
  );
}
