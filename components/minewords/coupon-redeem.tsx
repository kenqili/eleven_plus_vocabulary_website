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
      <h2>Have a code?</h2>
      <p className="muted">
        If access is being paid for by someone else - a school, a grandparent, a
        sponsor - enter the code they sent you and your child&apos;s access will
        be extended.
      </p>
      <label htmlFor="coupon-code">Your code</label>
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
        {busy ? "Checking…" : "Add this code"}
      </button>
    </form>
  );
}
