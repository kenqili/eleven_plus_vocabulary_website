"use client";
import { useEffect, useRef } from "react";
import { usePlaySound } from "./sound-provider";
import { useSoundToggle } from "./sound-toggle";
import type { SoundName } from "./sounds";

/**
 * Plays a sound when an event happens, at most once per event.
 *
 * The identity of the event is passed in rather than a list of dependencies,
 * because the interesting transitions are values, not functions. The event
 * identity has to be genuinely unique per event: a key built from the values
 * that happen to be on screen fires once and then goes silent for every
 * subsequent event that looks the same, which is how a run of correct answers
 * produced one chime and then nothing.
 */
export function useEventSound(key: string | number | null, sound: SoundName) {
  const play = usePlaySound();
  const { on } = useSoundToggle();
  const last = useRef<string | number | null>(null);
  useEffect(() => {
    if (!on || key === null || key === last.current) return;
    last.current = key;
    play(sound);
  }, [key, sound, on, play]);
}

/**
 * Sounds for a practice answer. The right sound depends on more than right
 * and wrong: revealing the answer is not a failure, and a word finally
 * mastered is a bigger moment than a correct answer.
 */
export function useAnswerSound(
  feedback: {
    correct: boolean;
    skipped: boolean;
    streak?: number;
    mastered?: boolean;
    attemptId?: string;
  } | null,
) {
  const sound: SoundName = !feedback
    ? "select"
    : feedback.skipped
      ? "reveal"
      : !feedback.correct
        ? "wrong"
        : feedback.mastered
          ? "mastered"
          : feedback.streak && feedback.streak >= 3
            ? "streak"
            : "correct";
  // The attempt id identifies this answer and nothing else. Everything that
  // could repeat is deliberately left out, including the streak, because two
  // right answers with the same streak are still two answers.
  useEventSound(feedback ? (feedback.attemptId ?? null) : null, sound);
}

/**
 * A short blip under a tap, so a button feels like it was pressed. Mounted
 * once at the root rather than per screen, which is what makes every tappable
 * thing in the app make the same noise.
 */
export function useTapSound() {
  const play = usePlaySound();
  const { on } = useSoundToggle();
  useEffect(() => {
    if (!on) return;
    const tap = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("button:not(:disabled), a[href], [role='button']")
      )
        play("select");
    };
    document.addEventListener("pointerdown", tap, { passive: true });
    return () => document.removeEventListener("pointerdown", tap);
  }, [on, play]);
}
