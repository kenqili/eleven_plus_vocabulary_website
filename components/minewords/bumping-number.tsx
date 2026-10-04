"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that ticks up when it changes, so a child sees the answer they just
 * given move something.
 *
 * A plain counter would do the job. This exists because the count going from 40
 * to 41 is otherwise invisible on a panel that also shows a streak and a
 * balance, and a word being retired is the single largest thing that answer
 * achieved. The animation is attached only to a change, not to the steady state,
 * so a panel that has not moved is not twitching.
 *
 * The value shown during the tick is the one being left, not the one arriving:
 * showing the new number mid-animation would mean a child could read "41" while
 * the mark was still on 40, and be right for a moment and then find it wrong.
 */
export function BumpingNumber({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  /** How to print the number; defaults to plain, so small counts read as before. */
  format?: (n: number) => string;
}) {
  const [bump, setBump] = useState(false);
  const was = useRef(value);

  useEffect(() => {
    if (was.current === value) return;
    was.current = value;
    // Off the first frame, or the browser coalesces the class with the paint
    // that rendered the new number and the animation never starts.
    const frame = requestAnimationFrame(() => setBump(true));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  useEffect(() => {
    if (!bump) return;
    // Held long enough to be seen, then cleared so the next change replays it.
    const timer = setTimeout(() => setBump(false), 520);
    return () => clearTimeout(timer);
  }, [bump]);

  return (
    <strong className={`${className ?? ""}${bump ? " mastered-count-bump" : ""}`.trim()}>
      {format ? format(value) : value}
    </strong>
  );
}
