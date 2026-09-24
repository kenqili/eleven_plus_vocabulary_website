"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ReadingProgress } from "@/lib/challenge/stories";

export function useReadingClock(
  storyId: string,
  enabled: boolean,
  onSaved: (progress: ReadingProgress) => void,
) {
  const saved = useRef(onSaved);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const [error, setError] = useState("");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  useEffect(() => {
    saved.current = onSaved;
  }, [onSaved]);
  useEffect(() => {
    let alive = true,
      ready = false,
      activity = Date.now(),
      unflushed = 0,
      sequence = 0;
    let lastSend = 0,
      running: Promise<void> | null = null;
    const owner = crypto.randomUUID();
    let retry: {
      action: string;
      storyId: string;
      owner: string;
      sequence: number;
      seconds: number;
    } | null = null;
    const flush = async () => {
      if (!enabled) return;
      if (running) {
        await running;
        // Finish/unmount must also save time collected during the pending request.
        if (unflushed || retry) return flush();
        return;
      }
      const work = async () => {
        lastSend = Date.now();
        try {
          if (!ready) {
            const progress = await api<ReadingProgress>("/api/stories", {
              action: "start",
              storyId,
              owner,
            });
            ready = true;
            if (!alive) return;
            if (alive) saved.current(progress);
          }
          const payload = retry || {
            action: "time",
            storyId,
            owner,
            sequence: ++sequence,
            seconds: unflushed,
          };
          if (!retry) {
            unflushed = 0;
            retry = payload;
          }
          const progress = await api<ReadingProgress>("/api/stories", payload, {
            keepalive: true,
          });
          retry = null;
          if (alive) {
            setError("");
            saved.current(progress);
          }
        } catch (e) {
          if (alive)
            setError(
              `Reading time could not be saved: ${(e as Error).message}`,
            );
          throw e;
        }
      };
      running = work();
      try {
        await running;
      } finally {
        running = null;
      }
    };
    flushRef.current = flush;
    const quietFlush = () => {
      void flush().catch(() => {});
    };
    const active = () => {
      activity = Date.now();
    };
    const pause = () => {
      setIsRunning(false);
      quietFlush();
    };
    const visibility = () => {
      if (document.hidden) pause();
      else active();
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll"];
    events.forEach((event) =>
      window.addEventListener(event, active, { passive: true }),
    );
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", active);
    window.addEventListener("pagehide", quietFlush);
    quietFlush();
    const timer = setInterval(() => {
      const reading =
        !document.hidden &&
        document.hasFocus() &&
        Date.now() - activity < 90000;
      setIsRunning(reading);
      if (reading) {
        setSessionSeconds((seconds) => seconds + 1);
        if (enabled && ready) unflushed = Math.min(30, unflushed + 1);
      }
      if (
        enabled &&
        Date.now() - lastSend >= 15000 &&
        (unflushed > 0 || retry || !ready)
      )
        quietFlush();
    }, 1000);
    return () => {
      alive = false;
      quietFlush();
      flushRef.current = async () => {};
      clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, active));
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", active);
      window.removeEventListener("pagehide", quietFlush);
    };
  }, [storyId, enabled]);
  return {
    error,
    sessionSeconds,
    isRunning,
    flush: useCallback(() => flushRef.current(), []),
  };
}
