"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";

/**
 * Where a parent lands from an emailed link, to choose a new password.
 *
 * The token is read in the browser rather than handed in from the server
 * because it only exists in this page's URL, and window does not exist while
 * this is server-rendered. It is then checked with a GET before the form is
 * drawn. Trusting it from the URL would put a password box on the page for any
 * token anyone cared to type; checking it first is what lets the page say
 * "already used" before anyone has typed a password, rather than after.
 *
 * The address is named above the form because a parent with two accounts would
 * otherwise change the wrong one, which is a lockout rather than a near miss.
 * The second field exists because a mistyped password here is the one mistake
 * with no way back short of another email, and the check is free.
 */
type Stage =
  | { state: "checking" }
  | { state: "no-token" }
  | { state: "expired" }
  | { state: "unreachable"; message: string }
  | { state: "ready"; email: string; token: string }
  | { state: "done" };

export default function ResetPassword() {
  const [stage, setStage] = useState<Stage>({ state: "checking" });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const check = async (): Promise<Stage> => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) return { state: "no-token" };
      const result = await api<{ ok: true; email: string } | { ok: false }>(
        `/api/password-reset/check?token=${encodeURIComponent(token)}`,
      );
      return result.ok
        ? { state: "ready", email: result.email, token }
        : { state: "expired" };
    };
    void check()
      .then(setStage)
      .catch((problem: Error) =>
        setStage({ state: "unreachable", message: problem.message }),
      );
  }, []);

  const mismatch = confirmation.length > 0 && confirmation !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (stage.state !== "ready") return;
    setAttempted(true);
    if (password !== confirmation) {
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/password-reset/confirm", {
        token: stage.token,
        password,
      });
      setPassword("");
      setConfirmation("");
      setStage({ state: "done" });
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="workspace">
        <section className="account-card">
          <div className="eyebrow">YOUR MINEWORDS</div>
          {stage.state === "checking" ? (
            <p role="status">Checking your link…</p>
          ) : stage.state === "no-token" ? (
            <>
              <h1>This link is incomplete.</h1>
              <p className="muted">
                The link from your email carries a code, and this one does not.
                Copy the whole link from the message, or ask for another one.
              </p>
              <Link className="primary-button" href="/account">
                Ask for a new link
              </Link>
            </>
          ) : stage.state === "expired" ? (
            <>
              <h1>This reset link has expired or has already been used.</h1>
              <p className="muted">
                Each link works once, and only for a few hours. A new one takes
                a moment to arrive.
              </p>
              <Link className="primary-button" href="/account">
                Ask for a new link
              </Link>
            </>
          ) : stage.state === "unreachable" ? (
            <>
              <h1>We could not check that link.</h1>
              <p className="form-error" role="alert">
                {stage.message}
              </p>
              <Link className="primary-button" href="/account">
                ← Back to your account
              </Link>
            </>
          ) : stage.state === "done" ? (
            <>
              <h1>Your password has been changed.</h1>
              <p role="status">
                You are signed in on this device now, so there is nothing else
                to do. Your child&rsquo;s saved words and progress are exactly
                as they were.
              </p>
              <Link className="primary-button" href="/">
                Go and practise →
              </Link>
            </>
          ) : (
            <>
              <h1>Choose a new password.</h1>
              <p className="muted">Resetting the password for {stage.email}</p>
              <form onSubmit={submit}>
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <label htmlFor="confirm-password">Type it again</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <p className="muted">
                  At least 8 characters. A short phrase you will remember works
                  better than a long one you will not.
                </p>
                {attempted && mismatch ? (
                  <p className="form-error" role="alert">
                    The two passwords are not the same. Type the same one twice.
                  </p>
                ) : null}
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button className="primary-button" disabled={busy}>
                  {busy ? "Please wait…" : "Change my password"}
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    </>
  );
}
