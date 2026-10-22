"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lightbulb, X } from "lucide-react";
import {
  nextTip,
  readSeenTips,
  rememberTip,
  TIP_AFTER_ANSWERS,
  type UsageTip,
} from "@/lib/client/usage-tips";

/**
 * A tip for the parent, shown while their child practises.
 *
 * The app has more in it than any parent can find on their own, and the
 * features that matter most — setting aside a word, marking a known word,
 * seeing the word map — are the ones nobody thinks to look for. So one tip is
 * offered at a time, in the parent's column, and only once.
 *
 * It is not a nag. A tip is offered once, and is remembered in this browser
 * the moment it appears, so the next session brings the next tip rather than
 * the same one again. The alternative — the same advice on every visit — is
 * how a useful banner turns into furniture.
 */
export default function UsageTips({
  answered,
  hasAccess,
}: {
  /** How many questions the child has answered this session. */
  answered: number;
  /** Whether this family may use the paid features. */
  hasAccess: boolean;
}) {
  const [tip, setTip] = useState<UsageTip | null>(null);

  useEffect(() => {
    if (answered < TIP_AFTER_ANSWERS) return;
    // Deferred a turn so the panel arrives after the answer it follows rather
    // than in the same paint, and so the browser's storage is read on the
    // client rather than during the server's render. The lint rule is right
    // that setState in an effect body is usually a cascading render; here it
    // is a panel shown once, not derived state.
    const timer = window.setTimeout(() => {
      const next = nextTip(readSeenTips());
      if (!next) return;
      if (next.needsAccess && !hasAccess) return;
      // Marked as seen the moment it is offered, not when it is dismissed. A
      // tip that comes back because nobody pressed the close button is a tip
      // that has started to nag, and a parent who ignores a banner stops
      // reading every banner after it.
      rememberTip(next.id);
      setTip(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [answered, hasAccess]);

  if (!tip) return null;

  const dismiss = () => setTip(null);

  return (
    <aside className="usage-tip" aria-label="A tip for you">
      <span className="usage-tip-mark" aria-hidden>
        <Lightbulb size={17} />
      </span>
      <div className="usage-tip-body">
        <strong>{tip.title}</strong>
        <p>{tip.text}</p>
        {tip.href && tip.linkText ? (
          <Link href={tip.href} onClick={dismiss}>
            {tip.linkText} →
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        className="usage-tip-dismiss"
        onClick={dismiss}
        aria-label="Hide this tip"
        title="Hide this tip"
      >
        <X size={15} aria-hidden />
      </button>
    </aside>
  );
}
