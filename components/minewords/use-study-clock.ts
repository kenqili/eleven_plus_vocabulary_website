"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Stats } from "@/lib/challenge/types";

/**
 * Study time is accumulated in the browser and written in one batch rather than
 * every few seconds. A session is at most an hour or so, so this turns hundreds
 * of rows a day per child into about a dozen, and the server still clamps every
 * claim to the wall time that actually elapsed. Leaving the page, hiding the tab
 * and unmounting all flush immediately, so what is left to lose is bounded by
 * one batch: a hard crash, or a tab that is closed without firing pagehide.
 */
const FLUSH_SECONDS = 300;

export function useStudyClock(
  attemptId: string | undefined,
  enabled: boolean,
  onSaved: (stats: Partial<Stats>) => void,
) {
  const [seconds, setSeconds] = useState(0),
    [error, setError] = useState("");
  const current = useRef({ attemptId, enabled, onSaved });
  useEffect(() => {
    current.current = { attemptId, enabled, onSaved };
  }, [attemptId, enabled, onSaved]);
  const owner = useRef(""),
    sequence = useRef(0),
    unflushed = useRef(0),
    activity = useRef(0);
  const running = useRef<Promise<void> | null>(null);
  const lastSend = useRef(0);
  const retry = useRef<{
    action: string;
    owner: string;
    sequence: number;
    seconds: number;
    attemptId: string;
  } | null>(null);
  const flush = useCallback(async () => {
    // A flush asked for while one is already in flight waits for it and then
    // carries on, rather than returning the pending promise. Returning dropped
    // whatever accrued in the meantime on the floor: at most 15 seconds while
    // ticks were that frequent, and a whole 300 second batch now. The flushes
    // that most need to land are the ones a closing browser is about to cancel.
    // Written as a wait and then a fall-through rather than a recursive call,
    // because re-entering the callback is what a hooks rule rightly objects to.
    if (running.current) await running.current;
    if (!current.current.enabled || !current.current.attemptId) return;
    // Nothing accrued and nothing to retry, so there is no request to make.
    // Sending one anyway doubled the round trips per question and held the
    // card disabled for the duration of an empty call.
    if (!unflushed.current && !retry.current) return;
    if (!owner.current) owner.current = crypto.randomUUID();
    const work = async () => {
      lastSend.current = Date.now();
      const payload = retry.current || {
        action: "time",
        owner: owner.current,
        sequence: ++sequence.current,
        seconds: Math.min(FLUSH_SECONDS, unflushed.current),
        attemptId: current.current.attemptId!,
      };
      if (!retry.current) {
        unflushed.current -= payload.seconds;
        retry.current = payload;
      }
      try {
        const result = await api<Partial<Stats>>("/api/rewards", payload, {
          keepalive: true,
        });
        retry.current = null;
        setError("");
        setSeconds(unflushed.current);
        current.current.onSaved(result);
      } catch (e) {
        setError(`Study time could not be saved: ${(e as Error).message}`);
      }
    };
    running.current = work();
    await running.current;
    running.current = null;
  }, []);
  useEffect(() => {
    activity.current = Date.now();
    if (enabled && attemptId) void flush();
  }, [enabled, attemptId, flush]);
  useEffect(() => {
    const active = () => {
      activity.current = Date.now();
    };
    const visibility = () => {
      if (document.hidden) void flush();
      else active();
    };
    // pointermove is deliberately not listened for. It fired on every mouse
    // movement for the whole session just to reset a timestamp, which is a
    // main-thread callback on the hot path of a cheap phone. A press or a
    // keystroke already says the person is here, and scrolling is throttled.
    for (const name of ["pointerdown", "keydown"])
      window.addEventListener(name, active, { passive: true });
    let scrolledAt = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - scrolledAt < 1000) return;
      scrolledAt = now;
      active();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    const leave = () => {
      void flush();
    };
    window.addEventListener("pagehide", leave);
    const interval = setInterval(() => {
      if (
        current.current.enabled &&
        current.current.attemptId &&
        !document.hidden &&
        document.hasFocus() &&
        Date.now() - activity.current < 60000
      ) {
        unflushed.current = Math.min(FLUSH_SECONDS, unflushed.current + 1);
        setSeconds(unflushed.current + (retry.current?.seconds || 0));
      }
      // The batch trigger and the retry trigger are on separate clocks. A full
      // batch is the normal case and is worth waiting for. A retry is not: it
      // means the last attempt failed and the child is looking at "We'll retry
      // automatically", so it goes back out on the old short cadence rather than
      // leaving the message up for the length of a whole batch interval.
      const since = Date.now() - lastSend.current;
      if (retry.current && since >= 15000) void flush();
      else if (
        unflushed.current >= FLUSH_SECONDS &&
        since >= FLUSH_SECONDS * 1000
      )
        void flush();
    }, 1000);
    return () => {
      void flush();
      clearInterval(interval);
      for (const name of ["pointerdown", "keydown"])
        window.removeEventListener(name, active);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, [flush]);
  return { seconds, flush, error };
}
