"use client";
import { useEffect, useState } from "react";
import { EyeOff, Undo2 } from "lucide-react";
import { api } from "@/lib/client/api";

/**
 * Sets a word aside for this account, which hides it from the word list and
 * stops it coming up in practice.
 *
 * This sits inside a list of forty rows, and a stray tap on the word a child
 * finds hardest is the likely mistake. So it confirms first, says plainly what
 * will happen, and then offers an undo rather than leaving the only way back on
 * a different page.
 */
export default function ExcludeWordButton({
  wordId,
  word,
  onChanged,
}: {
  wordId: string;
  word: string;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [undo, setUndo] = useState(false);
  const [error, setError] = useState("");

  // The undo offer is a window, not a promise: after it closes the word stays
  // set aside and Manage words is where it is brought back.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(false), 10000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const exclude = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/parent-words", { action: "exclude", wordId });
      setAsking(false);
      setUndo(true);
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not set that aside.",
      );
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/parent-words", { action: "restore", wordId });
      setUndo(false);
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not bring it back.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (undo)
    return (
      <div className="exclude-word">
        <span className="undo-note" role="status">
          {word} set aside.
        </span>
        <button
          type="button"
          className="manage-action"
          disabled={busy}
          onClick={() => void restore()}
        >
          <Undo2 size={14} aria-hidden /> Undo
        </button>
      </div>
    );

  if (asking)
    return (
      <div className="exclude-word">
        <p className="undo-note">
          Take <strong>{word}</strong> out of practice?
        </p>
        <div className="undo-row">
          <button
            type="button"
            className="manage-action"
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            Keep it
          </button>
          <button
            type="button"
            className="manage-action destructive"
            disabled={busy}
            onClick={() => void exclude()}
          >
            Set aside
          </button>
        </div>
      </div>
    );

  return (
    <div className="exclude-word">
      <button
        type="button"
        className="manage-action"
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        <EyeOff size={14} aria-hidden /> Set aside
        <span className="sr-only"> {word}</span>
      </button>
      {error ? (
        <span className="manage-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
