"use client";

import { useEffect } from "react";

/**
 * Starts a fetch when the browser is idle rather than when it is needed.
 *
 * The vocabulary index is 159 KB and the story index 13 KB. Both were fetched at
 * the moment a child first tapped Listen, which is the moment they are least
 * patient and least likely to press the button again. A prefetch moves the cost
 * to a moment where nobody is waiting, and by the time the button is pressed the
 * response is already in the cache.
 *
 * Two limits, both because this is a children's site on a metered connection:
 *
 * A prefetch is a low-priority request the browser may never make at all, which
 * is the right failure. It is not a preload, which would compete with the
 * content the child is actually trying to read.
 *
 * And it is not sent at all on a save-data or slow connection. A child on a
 * limited plan should get the clip when they ask for it, not a speculative
 * index they may never need.
 */
export function prefetchWhenIdle(url: string, signal?: AbortSignal): void {
  if (typeof window === "undefined") return;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return;
  if (connection?.effectiveType && /^(slow-2g|2g|3g)$/.test(connection.effectiveType))
    return;

  const go = () => {
    if (signal?.aborted) return;
    void fetch(url, { signal, priority: "low" } as RequestInit).catch(() => {
      // A failed prefetch is not an error worth reporting: the real fetch on the
      // tap will report it, in the place a child can act on it.
    });
  };

  // requestIdleCallback is not everywhere, and a timeout is needed there anyway
  // so a busy main thread cannot postpone this indefinitely.
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (idle) idle(go, { timeout: 3000 });
  else setTimeout(go, 1200);
}

/** Stops a prefetch that has not gone out yet, on unmount. */
export function useIdlePrefetch(url: string | null): void {
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    prefetchWhenIdle(url, controller.signal);
    return () => controller.abort();
  }, [url]);
}
