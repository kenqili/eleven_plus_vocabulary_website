"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Stats } from "@/lib/challenge/types";

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
    if (running.current) return running.current;
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
        seconds: Math.min(30, unflushed.current),
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
        unflushed.current = Math.min(30, unflushed.current + 1);
        setSeconds(unflushed.current + (retry.current?.seconds || 0));
      }
      if (
        (unflushed.current >= 15 || retry.current) &&
        Date.now() - lastSend.current >= 15000
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
