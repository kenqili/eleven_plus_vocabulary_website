"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";

/**
 * Where a parent lands from the confirmation email, to open their new account.
 *
 * The link in that message has to land on a page, and until this one existed the
 * only thing answering the path the email built was the API: a parent who
 * registered was sent a link that 404s, and could not sign in either. This is the
 * page the emailed path opens, and it is here rather than being left to the API so
 * that the one screen a new parent sees says something.
 *
 * The token is read in the browser rather than handed in from the server because
 * it only exists in this page's URL, and window does not exist while this is
 * server-rendered. It is then spent with a GET before any of this page is drawn,
 * so that a link which is dead - expired, already used, or never real - is
 * reported as dead here, rather than leaving a parent looking at a confirmation
 * that did not happen.
 *
 * Nothing is asked for here. There is no form, because the only thing this link
 * can do is confirm an address, and a box on this page would be an invitation to
 * type a password into a link somebody forwarded.
 */
type Stage =
  | { state: "checking" }
  | { state: "no-token" }
  | { state: "refused" }
  | { state: "unreachable"; message: string }
  | { state: "done" };

export default function ConfirmEmail() {
  const [stage, setStage] = useState<Stage>({ state: "checking" });
  // The link is spent by this request and by nothing else, so it is allowed to
  // fire once. A single-use link that two runs share would be spent by the first
  // and refused by the second, and a parent would be told their own link had
  // already been used.
  const spent = useRef(false);

  useEffect(() => {
    if (spent.current) return;
    spent.current = true;
    const confirm = async (): Promise<Stage> => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) return { state: "no-token" };
      await api<{ ok: true }>(
        `/api/confirm-email?token=${encodeURIComponent(token)}`,
      );
      return { state: "done" };
    };
    void confirm()
      .then(setStage)
      .catch((problem: Error) => {
        // A 400 is the link being refused - expired, spent, or never real - and
        // it is the answer the page exists to give. Anything else is the request
        // that did not happen, and telling a parent their link is dead when the
        // network dropped is the wrong thing to say.
        const status = (problem as Error & { status?: number }).status;
        setStage(
          status === 400
            ? { state: "refused" }
            : { state: "unreachable", message: problem.message },
        );
      });
  }, []);

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
          ) : stage.state === "refused" ? (
            <>
              <h1>This link has expired or has already been used.</h1>
              <p className="muted">
                Each link works once, and only for a day. If you have just
                confirmed this address, there is nothing left to do here - your
                account is open, and signing in will show you it.
              </p>
              <Link className="primary-button" href="/account">
                Sign in
              </Link>
            </>
          ) : stage.state === "unreachable" ? (
            <>
              <h1>We could not check that link.</h1>
              <p className="error" role="alert">
                {stage.message}
              </p>
              <Link className="primary-button" href="/account">
                ← Back to your account
              </Link>
            </>
          ) : (
            <>
              <h1>Your email address is confirmed.</h1>
              <p className="muted" role="status">
                That was the last step. Sign in with the address you registered
                and the password you chose, and your child&rsquo;s saved words
                and progress will be exactly as you left them.
              </p>
              <Link className="primary-button" href="/account">
                Sign in and carry on →
              </Link>
            </>
          )}
        </section>
      </main>
    </>
  );
}
