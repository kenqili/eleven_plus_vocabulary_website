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
 *
 * Both controls end this session, and neither says so here. This component is
 * rendered only while a parent is signed in, so the call that signs them out
 * also unmounts it, and a sentence held in its own state would be destroyed at
 * the exact moment it had something to say. So the sentence goes to the parent
 * through `onSignedOut`, which can hold it in a notice that outlives the
 * component. It is a callback rather than a shared store because a store is a
 * second way of knowing who is signed in, and there is already exactly one.
 */
export default function AccountSecurity({
  onSignedOut,
}: {
  onSignedOut: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ signedOut: number }>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      // The password has changed. Everything below is about leaving, and none
      // of it is allowed to look like the change failed.
      //
      // Why the parent is signed out at all, which the code does not say: the
      // only way to know the new password works is to make them use it. A typo
      // here is otherwise discovered at the next sign-in - a different device, a
      // week later, with nobody around to help - and this account cannot be
      // signed into without email_verified_at, so a new password that does not
      // match what was intended locks a parent out of an account that worked all
      // morning. Catching it here, on the page they are already on, is the whole
      // reason for signing them out of the one they just used.
      //
      // The server leaves this device holding a fresh, valid session, and that
      // cookie is deliberately revoked rather than left to expire. Left alone it
      // would still be accepted, and the account page reads it on load, so a
      // reload would put the parent straight back on the account card and they
      // would never type the new password at all - the exact thing this is for.
      // Signing a parent out of a session that is genuinely valid is the
      // intention, not a side effect of tidying up.
      try {
        await api("/api/auth/logout", {});
      } catch {
        // Swallowed, and the parent is signed out on screen either way. The
        // password DID change, so a tidy-up that failed must not be reported as
        // a change that failed, and leaving a signed-in account on screen is the
        // state this whole flow exists to end. What the failure can leave
        // behind is a cookie that expires on its own and is worth nothing
        // without the new password.
      }
      const others =
        result.signedOut === 1 ? "one other device" : `${result.signedOut} other devices`;
      // The count of other devices comes from the server and is kept, because
      // "is anybody else still signed in" is what a parent changing a password
      // after a scare actually wants answered.
      onSignedOut(
        result.signedOut > 0
          ? `Password changed. Signed out on ${others}. Sign in with your new password.`
          : "Password changed. Sign in with your new password.",
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
      await api("/api/auth/signout-all", {
        method: "POST",
        body: "{}",
      });
      // One message whatever the server counted. That count is session rows
      // deleted, which already includes this device, and the only way it can
      // read zero is another request having got there first - in which case this
      // device is signed out all the same, and a "no other devices were signed
      // in" would be shown to a parent who has just been signed out of this one.
      // The server has already expired this device's cookie, so there is no
      // session left to revoke: signing out is the parent's half of the work and
      // the only place the two halves meet is onSignedOut.
      onSignedOut(
        "Signed out everywhere, including this device. Sign in again with your password.",
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
            At least 8 characters. Changing it signs out every other device and
            this one, and you sign in again with the new password.
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
