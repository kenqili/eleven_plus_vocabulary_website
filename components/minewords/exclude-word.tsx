"use client";
import { useState } from "react";
import { EyeOff } from "lucide-react";
import { api } from "@/lib/client/api";

/**
 * Sets a word aside for this account. Signed-out visitors are sent to sign in
 * rather than shown a control that cannot work.
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
  const [error, setError] = useState("");

  const exclude = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/parent-words", { action: "exclude", wordId });
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not set that word aside.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="exclude-word">
      <button
        type="button"
        className="manage-action"
        disabled={busy}
        onClick={exclude}
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
