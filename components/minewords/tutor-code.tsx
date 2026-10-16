"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";

/** What the server says a tutor code is worth, before anyone pays. */
export type TutorQuote = {
  label: string;
  tutorName: string;
  percentOff: number;
  tier: string;
  currency: string;
  amount: number;
  discounted: number;
  usual: string | null;
};

/**
 * A tutor's code, entered before buying.
 *
 * Display only: applying it here changes what the 1-year button shows and what
 * it sends, but the discount itself is validated again at checkout and computed
 * by Stripe at payment. A code the tutor has since had suspended still shows
 * here until the parent presses buy, at which point checkout refuses it - the
 * screen cannot promise what the payment then refuses, so the button carries
 * the code every time rather than the quote being trusted after the first one.
 */
export default function TutorCode({
  applied,
  onApplied,
  onClear,
}: {
  applied: TutorQuote | null;
  onApplied: (quote: TutorQuote) => void;
  onClear: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onApplied(await api<TutorQuote>("/api/tutor-code", { code }));
      setCode("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That code did not work.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (applied)
    return (
      <p role="status">
        Tutor code <strong>{applied.label}</strong> applied —{" "}
        {applied.percentOff}% off the 1-year option.{" "}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onClear}
        >
          Remove
        </button>
      </p>
    );

  return (
    <form onSubmit={(event) => void apply(event)} className="tutor-code-form">
      <label>
        Tutor code, if your tutor gave you one
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="e.g. TUTOR-SARAH-20"
          autoComplete="off"
          disabled={busy}
        />
      </label>
      <button type="submit" className="text-button" disabled={busy || !code.trim()}>
        {busy ? "Checking…" : "Apply code"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
