"use client";

/**
 * Where a parent enters a code they were sent.
 *
 * Shown to every signed-in parent, not only to those whose access has lapsed,
 * because a code is often sent to renew before anything runs out - and a field
 * that appears only after the child has lost access arrives one day too late to
 * be useful to whoever arranged it.
 *
 * Its own component rather than part of the account page, because the account
 * page is already large and this is separable: it needs one thing from outside
 * (a refresh, so the new expiry is shown without a reload) and holds the rest.
 */
import { useState } from "react";
import { api } from "@/lib/client/api";

export default function CouponRedeem({
  onRedeemed,
}: {
  onRedeemed: (message: string) => void | Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      // `api(path, data)` - the payload is the second argument and `api` sets the
      // method and serialises the body itself. Sending `{method, body}` here
      // would deliver that object as the payload, so the code would never arrive
      // and every attempt would be refused as invalid.
      const result = await api<{ message: string }>("/api/coupon", { code });
      // Cleared on success only. Clearing it on a refusal would throw away a
      // mistyped code, which is the thing most likely to need correcting.
      setCode("");
      await onRedeemed(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="manage-form" onSubmit={submit}>
      <h2>Redeem a gift card</h2>
      {/* Framed as a gift card rather than as hardship support: leading with
          "if the cost is a problem" puts a label on the family at the moment
          they arrive to keep their child practising, and a code is simply
          access somebody arranged. Still no claim about who arranged it or
          whether money changed hands - a relative, a school, a tutor and a
          hardship grant all use this one field, and the parent already knows
          which. Guessing would be wrong for most readers and awkward for the
          rest. */}
      <p className="muted">
        If you have been given a code or a gift card — from a tutor, a school,
        somebody who knows your child, or us — enter it here and their access
        will be extended straight away.
      </p>
      <label htmlFor="coupon-code">Gift card code</label>
      <input
        id="coupon-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        // autocomplete="off" rather than "one-time-code": this is not an SMS or
        // TOTP code, and letting a browser offer one here would be offering the
        // wrong thing to paste.
        autoComplete="off"
        spellCheck={false}
        // Padded generously because the code is 20 characters and is being typed
        // or pasted from an email.
        maxLength={80}
        placeholder="ABCDEFGH23456789ABCD"
        required
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Checking…" : "Redeem code"}
      </button>
    </form>
  );
}
