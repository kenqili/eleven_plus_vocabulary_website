"use client";

import { useEffect, useRef } from "react";

/**
 * The Cloudflare Turnstile widget, rendered where a form needs a human check.
 *
 * The site's own rule for third-party scripts is that there is one, and it is
 * this: the script is loaded on the pages that need a challenge, not in the
 * layout, and only when the server has both Turnstile settings. A page that
 * cannot verify a token renders nothing rather than asking a visitor to solve a
 * check whose answer is thrown away.
 *
 * `onToken` is called with the token when the challenge passes and with null
 * when it expires or fails. The parent keeps that token and sends it with the
 * form; `resetSignal` re-runs the challenge, which has to happen after a failed
 * submit because a token works once.
 */
type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme?: "auto" | "light" | "dark";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cf-turnstile-script";

/** Load the widget script once, for whichever forms are on the page. */
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    // A blocked script must not leave a form sitting behind a promise that never
    // settles; the server refuses the submission with a sentence either way.
    script.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(script);
  });
}

export default function Turnstile({
  siteKey,
  onToken,
  resetSignal = 0,
}: {
  /** Empty when the check is not configured; nothing is rendered then. */
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Increment to run the challenge again, after a rejected submission. */
  resetSignal?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const latestToken = useRef(onToken);
  useEffect(() => {
    latestToken.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !container.current || !window.turnstile) return;
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: (token) => latestToken.current(token),
        "expired-callback": () => latestToken.current(null),
        "error-callback": () => latestToken.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
        widget.current = null;
      }
    };
  }, [siteKey]);

  // The first render is not a reset. Every later value is.
  const seen = useRef(resetSignal);
  useEffect(() => {
    if (seen.current === resetSignal) return;
    seen.current = resetSignal;
    if (widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      latestToken.current(null);
    }
  }, [resetSignal]);

  if (!siteKey) return null;
  return <div className="turnstile-check" ref={container} />;
}
