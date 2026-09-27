"use client";

import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { api } from "@/lib/client/api";

/**
 * Change the password, and sign out everywhere else.
 *
 * Two controls rather than one, because they answer two different worries. A
 * parent who wants a new password is tidying up. A parent who thinks someone
 * else has their password is closing a door, and being made to change the
 * password as well would be a worse answer than the one they asked for.
 *
 * The wording says what happened rather than what was intended. "Signed out on
 * every other device" is checkable; "for your security" is not.
 */
export default function AccountSecurity() {
  const [asking, setAsking] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ signedOut: number }>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent("");
      setNext("");
      setAsking(false);
      const others =
        result.signedOut === 1 ? "one other device" : `${result.signedOut} other devices`;
      setDone(
        result.signedOut > 0
          ? `Password changed. Signed out on ${others}.`
          : "Password changed.",
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ signedOut: number }>("/api/auth/signout-all", {
        method: "POST",
        body: "{}",
      });
      setDone(
        result.signedOut > 0
          ? `Signed out everywhere, including this device. Sign in again below.`
          : "No other devices were signed in.",
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-security">
      <h2>
        <KeyRound size={17} aria-hidden /> Password and sign-in
      </h2>

      {done && (
        <p className="manage-notice" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {asking ? (
        <form onSubmit={submit}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <p className="muted">
            At least 8 characters. Changing it signs out every other device.
          </p>
          <div className="account-actions">
            <button className="primary-button" disabled={busy}>
              Change password
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                setCurrent("");
                setNext("");
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="account-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            <KeyRound size={15} aria-hidden /> Change password
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void signOutEverywhere()}
          >
            <LogOut size={15} aria-hidden /> Sign out everywhere
          </button>
        </div>
      )}
    </div>
  );
}
