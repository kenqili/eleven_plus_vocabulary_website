"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";

/** What the server says a discount code is worth, before anyone pays. */
export type DiscountQuote = {
  label: string;
  /**
   * The tutor the code belongs to, or null when it is one of ours. The label is
   * what the parent sees; this is what the accounts side would need to know
   * whose code was used.
   */
  tutorName: string | null;
  percentOff: number;
  tier: string;
  currency: string;
  amount: number;
  discounted: number;
  usual: string | null;
};

/**
 * A discount code, entered before buying.
 *
 * One field for both kinds: a tutor's code and one of our own vouchers differ in
 * who they belong to and in the percent, not in how they are typed in or what
 * happens next. The server decides what a code may discount; this only shows the
 * parent what they were quoted.
 *
 * Display only: applying it here changes what the 1-year button shows and what
 * it sends, but the discount itself is validated again at checkout and computed
 * by Stripe at payment. A code that has since been suspended still shows here
 * until the parent presses buy, at which point checkout refuses it - the
 * screen cannot promise what the payment then refuses, so the button carries
 * the code every time rather than the quote being trusted after the first one.
 */
export default function DiscountCode({
  applied,
  onApplied,
  onClear,
}: {
  applied: DiscountQuote | null;
  onApplied: (quote: DiscountQuote) => void;
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
      onApplied(await api<DiscountQuote>("/api/discount-code", { code }));
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
        Discount code <strong>{applied.label}</strong> applied —{" "}
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
    // `manage-form` rather than a class of its own: that is the styling every
    // other code field on the account pages uses, so this one needs no CSS and
    // cannot drift from them.
    <form onSubmit={(event) => void apply(event)} className="manage-form">
      <label htmlFor="discount-code">Discount code</label>
      <input
        id="discount-code"
        type="text"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. TUTOR-SARAH-20"
        autoComplete="off"
        disabled={busy}
      />
      <button
        type="submit"
        className="text-button"
        disabled={busy || !code.trim()}
      >
        {busy ? "Checking…" : "Apply discount code"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
