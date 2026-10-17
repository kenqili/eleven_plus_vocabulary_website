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
      {/* Framed as a gift card rather than as hardship support, because leading
          with "if the cost is a problem" labels the family as struggling at the
          moment they arrive at the screen to keep their child practising.
          Deliberately still says nothing about who funded it: the copy must not
          name a payer or imply that money changed hands, which is both untrue
          for these codes and the thing tests/coupon.test.mjs refuses on purpose.
          What it does say is true - the code covers a term. */}
      <p className="muted">
        If you have been sent a gift card or a code to cover a term, enter it
        here and your child&apos;s access will be extended straight away.
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
