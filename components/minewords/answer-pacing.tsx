"use client";
import { isPronouncing } from "./pronunciation";
import { useEffect, useState } from "react";
import type { NextDelay } from "@/lib/client/auto-next";
export default function AnswerPacing({
  id,
  delay,
  eligible,
  restart,
  next,
}: {
  id: string;
  delay: NextDelay;
  eligible: boolean;
  /**
   * Changes when a new screen replaces the feedback for the same question - the
   * mastered notice after "I know this word". The notice then gets the whole
   * delay rather than whatever was left of the answer's countdown, because it is
   * the screen the child is reading now. Pausing still wins: a child who pressed
   * "Stay here" is not advanced by a later press.
   */
  restart?: string;
  next: () => Promise<void>;
}) {
  const [paused, setPaused] = useState(() => isPronouncing());
  const [remaining, setRemaining] = useState<number>(delay);
  useEffect(() => {
    const pause = () => setPaused(true);
    const visibility = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("minewords:pause-auto-next", pause);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("minewords:pause-auto-next", pause);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id]);
  useEffect(() => {
    if (!delay || !eligible || paused || document.hidden) return;
    const end = Date.now() + delay * 1000;
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        clearInterval(timer);
        void next();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [delay, eligible, paused, restart, next]);
  if (!delay || !eligible) return null;
  return (
    <div className="answer-pacing">
      <span>
        {paused
          ? "Take your time. Choose Next word when you’re ready."
          : `Next word in ${remaining} seconds`}
      </span>
      {!paused && (
        <button className="text-button" onClick={() => setPaused(true)}>
          Stay here
        </button>
      )}
    </div>
  );
}
