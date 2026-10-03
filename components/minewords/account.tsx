"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";
import AccountSecurity from "./account-security";
import CouponRedeem from "./coupon-redeem";
import DeleteAccount from "./delete-account";
type User = { id: string; email: string };
type Billing = {
  active: boolean;
  ready: boolean;
  status: string;
  periodEnd: number | null;
  canManage: boolean;
  access: boolean;
  trial: boolean;
  trialDays: number;
  freeWordLimit: number;
  trialDaysRemaining: number;
  trialEndsAt: number | null;
  trialExpired: boolean;
  /**
   * This account has bought something, or been given something.
   *
   * Sent rather than worked out from the history, because `trialExpired` is
   * `!active && !trial` and is therefore true for a family whose *paid* term has
   * run out as well as for one whose free trial has. Without this the page could
   * not tell those two apart, and told a parent who had paid for a year that their
   * trial had ended.
   */
  everPaid: boolean;
  /** One purchasable length, as the server resolved it from Stripe. */
  prices: {
    tier: string;
    label: string;
    days: number;
    amount: number | null;
    currency: string;
    /** Stripe has this price set up as recurring, which this site does not use. */
    recurring: boolean;
  }[];
  /** What this parent has bought, and when the access from it runs out. */
  purchases: {
    label: string;
    days: number;
    status: string;
    boughtAt: number;
    expiresAt: number;
    extendedFrom: number | null;
    /** This row is a code somebody else paid for, not a purchase by this account. */
    viaCode: boolean;
  }[];
};

/**
 * A date, written the one way this page writes dates.
 *
 * Three places on this screen state the same kind of fact - when access ends, when
 * something was bought, how far a purchase reached - and they were using three
 * different formatters. The big one read "2 November 2026" and the table read
 * "02/11/2026", so a parent checking that the purchase they had just made was the
 * one that moved their access date was looking at two spellings of it and had no
 * reason to trust either.
 *
 * `undefined` locale on purpose: the reader gets their own language and format,
 * which is the choice the browser makes everywhere else on the site. The option bag
 * is fixed so the long form is the only form - the short numeric date on this
 * screen is the thing that was wrong.
 */
const date = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * How long a purchase may take before the browser stops waiting for it.
 *
 * Longer than `REQUEST_TIMEOUT_MS`, which is right for every other request here
 * because every other request here is one round trip to our own database. A
 * checkout is not: it may read a stored Stripe session, read a price, create a
 * session and write a row, and it does that before it can answer. See `pay`.
 */
const CHECKOUT_TIMEOUT_MS = 45000;

export default function Account() {
  const [user, setUser] = useState<User | null>(null),
    [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [register, setRegister] = useState(false),
    [error, setError] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [freeWordLimit, setFreeWordLimit] = useState(20);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [notice, setNotice] = useState("");
  const [resetting, setResetting] = useState(false),
    [resetEmail, setResetEmail] = useState("");
  /**
   * The parent is waiting for a confirmation, rather than for the form to work.
   *
   * This is a state of its own and not an error, because nothing has gone wrong:
   * the account exists, the message is on its way, and the only thing left is to
   * open it. Showing it as a failure would be both wrong and alarming on the one
   * screen a new parent is most anxious about.
   */
  const [awaitingLink, setAwaitingLink] = useState<string | null>(null);
  function refresh() {
    return api<{
      user: User | null;
      freeTrialDays: number;
      freeWordLimit: number;
    }>("/api/auth/me").then(async (result) => {
      setUser(result.user);
      setTrialDays(result.freeTrialDays);
      setFreeWordLimit(result.freeWordLimit);
      const billing = result.user
        ? await api<Billing>("/api/billing/status")
        : null;
      setBilling(billing);
      // Returned as well as set, so a caller that has just refreshed does not have
      // to ask again. The success branch below used to make a second request for
      // the answer `refresh()` had already been given - and if that second request
      // failed, the red "Something went wrong. Please try again." replaced the
      // payment confirmation a parent had just been shown, moments after paying.
      return billing;
    });
  }
  useEffect(() => {
    void refresh()
      .then(async (current) => {
        const checkout = new URLSearchParams(window.location.search).get(
          "checkout",
        );
        if (checkout === "success") {
          // Checked against what the server says, not asserted. The old wording
          // told a parent their membership "will appear", whatever the page then
          // showed - so a payment that was taken and never granted read as a
          // pending confirmation for as long as the parent kept looking. If the
          // access is not there, say so and say what to do.
          setNotice(
            current?.active
              ? // The same formatter as the "Access until" line below it, because
                // this notice and that line state the same fact on the same
                // screen. This one used to write a short numeric date, so a
                // parent who had just paid read "Access runs until 02/11/2026"
                // directly above "Access until 2 November 2026" and had no way
                // to tell whether they described the same day.
                `Payment received. Access runs until ${date(current.periodEnd!)}.`
              : "We have your payment, but your access has not been applied yet. It normally appears within a minute. If it does not, email us and we will sort it today.",
          );
        }
        if (checkout === "cancelled")
          setNotice(
            // Not "checkout", which is the word on Stripe's button rather than
            // ours, and not "the sample words", which is what a signed-in parent
            // with paid access does not have. What matters to a parent who pressed
            // back is whether they have been charged.
            "Payment cancelled — you have not been charged. You can carry on as you were.",
          );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        needsVerification?: boolean;
        message?: string;
      }>(`/api/auth/${register ? "register" : "login"}`, { email, password });
      setPassword("");
      // Registering no longer signs you in, so there is nothing to refresh. The
      // parent waits for the link instead.
      if (result?.needsVerification) {
        setAwaitingLink(email);
        return;
      }
      await refresh();
    } catch (e) {
      const failure = e as Error & { code?: string };
      // The one error that is a state rather than a failure, so it is shown as
      // the waiting screen with a way forward, not as a red message.
      if (failure.code === "email_unverified") {
        setAwaitingLink(email);
        return;
      }
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask for the link again.
   *
   * Present whenever a parent is waiting, and rate limited on the server, so this
   * is the answer for the parent who deleted it, or who mistyped the address and
   * needs to find out which it was. It cannot be used to discover whether an
   * address is registered: the reply is the same either way.
   */
  async function resend() {
    if (!awaitingLink) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/resend-verification", { email: awaitingLink });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /**
   * Ask for a reset link, from the sign-in form rather than a page of its own.
   *
   * The wording is the server's, not ours. A message that said "no account has
   * that address" would be a way of finding out who has one here, which is the
   * exact thing a reset flow should not hand over, so whatever comes back is
   * shown word for word.
   */
  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ ok: boolean; message: string }>(
        "/api/password-reset/request",
        { email: resetEmail },
      );
      setResetEmail("");
      setNotice(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /**
   * One button per length, each priced from Stripe rather than from a number in
   * this file - so the price a parent reads is the price their card will be
   * charged. Rendered in the order the server sent them, which is shortest first,
   * because that is the order a parent decides in.
   *
   * Shared by the two states rather than written twice, and that matters: it was
   * duplicated once and the copy drifted, so the options a family already paying
   * could have been offered at a different price from the ones it joined at.
   *
   * A button whose price could not be read is rendered disabled rather than
   * hidden, because the server sends an option with no amount when Stripe is
   * briefly unreachable and a list that silently loses an entry is worse than one
   * that admits it cannot price it.
   */
  function planOptions() {
    if (!billing?.prices.length) return null;
    return (
      <div className="plan-options">
        {billing.prices.map((plan) => (
          <button
            key={plan.tier}
            className="primary-button"
            disabled={busy || plan.amount === null || plan.recurring}
            onClick={() => void pay("checkout", plan.tier)}
          >
            {busy ? "Please wait…" : plan.label}
            {plan.amount !== null && !plan.recurring && (
              <>
                {" — "}
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: plan.currency,
                }).format(plan.amount / 100)}
              </>
            )}
            {plan.recurring && <span className="muted"> — not available</span>}
          </button>
        ))}
      </div>
    );
  }

  /**
   * Start a purchase, or open the billing portal.
   *
   * `tier` is the length, and it is sent rather than remembered in component
   * state: a parent who opens three tabs, or reloads mid-decision, must end up at
   * the checkout for the length they last chose, and the server re-reads the tier
   * from the request rather than from whatever it decided earlier in the session.
   *
   * Slower than the rest of the app, deliberately. A checkout is the one request
   * here that can make three sequential calls to Stripe - read the stored session,
   * read the price, create the session - and write to the database between them.
   * At the default fifteen seconds the browser would give up first on a slow
   * connection and tell the parent "That took longer than 15 seconds" while the
   * server carried on and created the session. The parent would then press the
   * button again, and either pay twice or be told the first attempt was already
   * under way. A timeout here does not stop the purchase; it only stops the parent
   * from being able to see it happen.
   */
  async function pay(action: string, tier?: string) {
    setBusy(true);
    setError("");
    try {
      // `api(path, data, options)` - the payload is the SECOND argument, and
      // `api` chooses the method and serialises the body itself. Passing
      // `{method, body}` here sends that object as the payload instead, so the
      // tier never arrives and the server refuses with a 400 that says nothing
      // useful in the log.
      const result = await api<{ url: string }>(
        `/api/billing/${action}`,
        tier ? { tier } : {},
        { timeoutMs: CHECKOUT_TIMEOUT_MS, safeToRetry: false },
      );
      window.location.assign(result.url);
    } catch (e) {
      // `membership_applied` is not a failure. The server has just applied a
      // payment that had not taken effect, and sent the parent back here; putting
      // that in the red error box reads as "the site is broken" when the opposite
      // happened. It goes to the notice line instead, which is a status, and the
      // membership state is re-read so the new expiry is on screen at once.
      //
      // The code is checked rather than the message, because a message is written
      // for people and can be reworded; the identifier cannot drift.
      const failure = e as Error & { code?: string };
      if (failure.code === "membership_applied") {
        setNotice(failure.message);
        // Released before the refresh, not after it.
        //
        // `refresh` is another round trip that reads three prices from Stripe, and
        // every plan button and the "Manage billing" button are disabled while
        // `busy` is set, showing "Please wait…". Awaiting it with the lock still
        // held left the page frozen on that message for several seconds at exactly
        // the moment the parent has just been told a payment was applied and is
        // most likely to reach for the next button.
        setBusy(false);
        await refresh().catch((e) => setError((e as Error).message));
        return;
      }
      setError(failure.message);
      setBusy(false);
    }
  }
  /**
   * This session is over, and the card on screen says otherwise.
   *
   * Both ways a parent can end one - changing the password, and signing out
   * everywhere - arrive here rather than clearing themselves. The account card
   * shows a Change password form that wants the password they have just
   * replaced, on a session the server has already ended, which is the one state
   * a parent must not be left looking at.
   *
   * The message is passed in rather than written here for a second reason: the
   * component that produces it is rendered only while a parent is signed in, so
   * this call unmounts it. Anything it held in its own state goes with it, and a
   * parent who typed a new password and was then shown a bare sign-in form has
   * learned nothing. The notice below is rendered outside the signed-in branch,
   * so this is the only place the sentence can live.
   */
  function endSession(message: string) {
    setUser(null);
    setBilling(null);
    setNotice(message);
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", {});
      endSession("You are signed out.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="workspace">
        <Link className="text-button" href="/">
          ← Back to the challenge
        </Link>
        <section className="account-card">
          {/*
            The one line on this screen a paying parent most needs to see, so it is
            at the top of the card rather than the bottom.

            It was last. On `?checkout=success` that put "Payment received. Access
            runs until 3 February 2027." about a thousand pixels down a page whose
            earlier contents are the membership card, three price buttons, the
            purchase table, the code field, the password form and the delete
            section - so a parent who had just been charged had to scroll past
            "Delete this account" to find out whether it worked. Nothing scrolls
            them there and nothing moves focus, so the likeliest outcome was a
            parent who assumed it had failed and pressed buy again.

            Above the eyebrow, so it is the first thing on the card in the reading
            order and the first thing focus reaches.

            `alert` rather than `status`, deliberately, and this is the one place in
            the file where that is right. A polite live region waits for a pause in
            whatever the screen reader is mid-sentence on, so a confirmation arriving
            on a fresh page load can simply be skipped - which for the one message
            that says "your payment worked" is the wrong trade.
          */}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="feedback" role="alert">
              {notice}
            </p>
          )}
          <div className="eyebrow">YOUR MINEWORDS</div>
          {loading ? (
            <p role="status">Loading your account…</p>
          ) : user ? (
            <>
              <h1>Your learning, saved.</h1>
              <p className="muted">Signed in as {user.email}</p>
              <hr />
              <h2>MineWords membership</h2>
              <p>
                Full vocabulary practice, saved mastery and progress across your
                devices.
              </p>
              {billing?.active ? (
                <>
                  <span className="pill">Membership active</span>
                  {/*
                    The end date, stated as a day and a month rather than
                    "Access through <date>". A parent who has just paid needs to
                    be able to check it against the length they bought, and a
                    bare date labelled as access does not say which term it is or
                    whether a coupon and a purchase have been added together.
                  */}
                  <p>
                    Access until{" "}
                    <strong>
                      {/*
                    No `* 1000` here. `expiry_date` is epoch milliseconds -
                    written with Date.now() by both the grant and the webhook - so
                    periodEnd is already milliseconds and multiplying again put the
                    date in the year 58805. The purchase history below got this
                    right, which is how the two disagreed on one screen.
                  */}
                      {date(billing.periodEnd!)}
                    </strong>
                  </p>
                  {/* And what that date is made of, so it is never a mystery. */}
                  {(() => {
                    // Built before rendering, because this used to render a `<p>`
                    // whose entire content was a full stop: a parent whose access
                    // came from a code, or whose purchase had been refunded, is
                    // shown the membership they have and then a lone "." beneath
                    // it, which reads as a page that failed rather than as a
                    // history with nothing paid in it.
                    //
                    // Codes are included, and named as codes. They were filtered
                    // out because this line matched on `status === "paid"` and a
                    // redemption is not paid - so the one grant that had not come
                    // from this account was the one the sentence silently omitted,
                    // while the table further down the same screen listed it.
                    const made = billing.purchases
                      .filter((p) => p.status !== "refunded")
                      .map((p) =>
                        p.viaCode
                          ? `${p.label} added ${date(p.boughtAt)}`
                          : `${p.label} bought ${date(p.boughtAt)}`,
                      );
                    return made.length ? (
                      <p className="muted">{made.join(", ")}.</p>
                    ) : null;
                  })()}
                  <Link className="primary-button" href="/">
                    Continue practising →
                  </Link>
                  {/*
                    The same lengths, offered to somebody who already has access.
                    This used to be reachable only when `active` was false, so a
                    parent whose access was running out could see the date it
                    ended but not the button that fixes it - which is the worst
                    moment to hide the price list. A term is bought to add to the
                    one they have, so this is "add more", not "renew".
                  */}
                  {!!billing.prices.length && (
                    <>
                      <h3>Add more access</h3>
                      <p className="muted">
                        Buying again adds to the access you have, rather than
                        replacing it.
                      </p>
                      {planOptions()}
                    </>
                  )}
                </>
              ) : (
                <>
                  {/*
                    Which of the three states this is, and they are genuinely
                    different.

                    `trialExpired` is `!active && !trial`, which is true for a family
                    whose *paid* year has run out as well as for one whose free trial
                    has. So this branch was telling a parent who had paid for a year
                    that their "full-access trial has ended" - which is not what
                    happened to them, and it is the branch they land in at the worst
                    possible moment. Their practice page was telling them the
                    opposite, correctly, so the same parent was told two different
                    stories on two screens on the same day.

                    So the three are named separately, and a lapsed paid term gets
                    the date it ran until - because that is the question they are
                    actually asking, and the answer is already in the payload.
                  */}
                  {billing ? (
                    <p className="muted">
                      {billing.everPaid ? (
                        <>
                          Your access has ended. It ran until{" "}
                          <strong>
                            {billing.periodEnd
                              ? date(billing.periodEnd)
                              : "the end of your last term"}
                          </strong>
                          . Buy a length below and it will be added to that date
                          — it does not replace it.
                        </>
                      ) : billing.trialExpired ? (
                        `Your free trial has ended. Continue with the ${freeWordLimit}-word free collection, or buy a length below to unlock every word. Your saved progress is safe.`
                      ) : (
                        <>
                          Your free account includes full access until{" "}
                          <strong>
                            {billing.trialEndsAt
                              ? date(billing.trialEndsAt)
                              : `${billing.trialDays} days after sign-up`}
                          </strong>
                          . You do not need a card to try it, and you will not
                          be charged unless you choose a length.
                        </>
                      )}
                    </p>
                  ) : (
                    /*
                     * Deliberately says nothing about trials or prices. `billing` is
                     * null when the membership request failed, and this used to fall
                     * through to the trial paragraph - so a parent whose status
                     * request timed out, on an account with a paid year, was told
                     * they had a free account. Saying nothing is the honest answer
                     * when we do not know; the error is shown at the top of this card.
                     */
                    <p className="muted">
                      We could not load your membership just now. Press Refresh
                      membership below to try again.
                    </p>
                  )}
                  {/*
                    "Below", and it is above. The buttons are rendered before this
                    paragraph because that is where a parent's eye goes, and the
                    sentence has to agree with the page. It did not: this used to say
                    "choose a length below" on a deployment where `prices` is empty
                    and there is nothing below but "Purchases are not open yet".
                  */}
                  {planOptions()}
                  {/*
                    Replaced by the three length buttons above. Kept as the only
                    thing here that depends on `ready`, because that is a statement
                    about the deployment rather than about a price - and a parent
                    whose payments are not configured should be told so, rather than
                    shown an empty space where the prices would be.
                  */}
                  {billing && !billing.ready && (
                    <p className="muted">
                      Purchases are not open yet. Your saved learning progress
                      remains available.
                    </p>
                  )}
                </>
              )}
              {/*
                Everything that has extended this account's access, and what each
                one did to the expiry. The two dates are the whole point: a parent
                who bought a second term needs to see that it was added to the
                first rather than replacing it, and a parent who has bought nothing
                needs to see an empty history rather than no section at all - which
                reads as a page that failed to load.

                Titled and headed by what happened rather than by who paid, because
                a code is in here too. This account did not buy it - a school, a
                grandparent or a sponsor did, which is the only reason the feature
                exists - and a heading that said "What you have bought" above a row
                for a code they were given asked a parent to reconcile a debt that
                does not exist.
              */}
              {!!billing?.purchases.length && (
                <section className="account-purchases">
                  <h2>Everything that has extended your access</h2>
                  <div className="word-table-wrap">
                    <table className="word-table">
                      <thead>
                        <tr>
                          <th scope="col">Length</th>
                          <th scope="col">Added</th>
                          <th scope="col">Access then ran until</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.purchases.map((purchase, index) => (
                          <tr key={`${purchase.boughtAt}-${index}`}>
                            <td>{purchase.label}</td>
                            <td>{date(purchase.boughtAt)}</td>
                            <td>
                              {date(purchase.expiresAt)}
                              {purchase.extendedFrom && (
                                <small className="muted">
                                  {" "}
                                  (added to {date(purchase.extendedFrom)})
                                </small>
                              )}
                            </td>
                            <td>
                              {/*
                                Three states, not two. This read "Paid" for
                                anything that was not a refund, so a code a
                                grandparent paid for was shown to the parent as a
                                purchase they had paid for - in the one table whose
                                job is to account for their money.

                                The day count is not rendered when it is zero,
                                which is what a code row looks like after the code
                                itself has been deleted: the length is read by
                                joining `coupons`, so with no code left to ask it
                                reads as 0. Printing that would say the code was
                                worth nothing, which is a different and wrong
                                claim - the parent has the access it bought.
                              */}
                              {purchase.status === "refunded"
                                ? "Refunded"
                                : purchase.viaCode
                                  ? purchase.days
                                    ? `Code redeemed — ${purchase.days} days, paid for by someone else`
                                    : "Code redeemed — paid for by someone else"
                                  : "Paid"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {billing?.canManage && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void pay("portal")}
                >
                  Manage billing
                </button>
              )}
              <CouponRedeem
                onRedeemed={async (message) => {
                  setNotice(message);
                  await refresh();
                }}
              />
              <nav className="account-links" aria-label="Your account pages">
                <Link href="/words">Word list</Link>
                <Link href="/words/manage">Choose which words to practise</Link>
                <Link href="/words/print">Printable word sheets</Link>
                <Link href="/calendar">Practice calendar</Link>
                <Link href="/info">The 11+ explained</Link>
              </nav>
              <div className="control-row">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    void refresh().catch((e) => setError(e.message));
                  }}
                >
                  Refresh membership
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void logout()}
                >
                  Sign out
                </button>
              </div>
              <AccountSecurity onSignedOut={endSession} />
              <DeleteAccount />
            </>
          ) : (
            <>
              <h1>
                {resetting
                  ? "Send yourself a new password."
                  : register
                    ? "Start your word journey."
                    : "Welcome back."}
              </h1>
              <p className="muted">
                {resetting
                  ? "Put in the email address you signed up with and we will send a link to set a new password."
                  : register
                    ? `Create a free account for ${trialDays} days of full access, then buy a length to keep practising. There is no subscription.`
                    : "Sign in to continue your vocabulary practice."}
              </p>
              {awaitingLink ? (
                <>
                  <h1>Check your inbox.</h1>
                  <p>
                    We sent a link to confirm <strong>{awaitingLink}</strong>.
                    Your account opens as soon as you use it.
                  </p>
                  <p className="muted">
                    The link lasts a day and works once. If it has not arrived
                    in a few minutes, look in the junk folder, or send another -
                    and if the address above is not one you can read, use the
                    button to go back and change it.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => void resend()}
                    disabled={busy}
                  >
                    {busy ? "Please wait…" : "Send the link again"}
                  </button>{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setAwaitingLink(null);
                      setRegister(false);
                    }}
                  >
                    Use a different address
                  </button>
                </>
              ) : resetting ? (
                <form onSubmit={requestReset}>
                  <label htmlFor="reset-email">Email address</label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    maxLength={254}
                  />
                  <p className="muted">
                    Check the junk folder if nothing arrives. You can keep using
                    the site meanwhile.
                  </p>
                  <button className="primary-button" disabled={busy}>
                    {busy ? "Please wait…" : "Email me a reset link"}
                  </button>
                </form>
              ) : (
                <form onSubmit={submit}>
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                  />
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                  />
                  <p className="muted">
                    At least 8 characters. A short phrase you will remember
                    works better than a long one you will not.
                  </p>
                  <button className="primary-button" disabled={busy}>
                    {busy
                      ? "Please wait…"
                      : register
                        ? "Create account"
                        : "Sign in"}
                  </button>
                </form>
              )}
              <p className="muted">
                {resetting ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetting(false);
                      setError("");
                      setNotice("");
                    }}
                  >
                    Back to sign in
                  </button>
                ) : (
                  <>
                    {register
                      ? "Already have an account?"
                      : "New to MineWords?"}{" "}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setRegister(!register);
                        setError("");
                      }}
                    >
                      {register ? "Sign in" : "Create an account"}
                    </button>
                    {!register && (
                      <>
                        {" · "}
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setResetting(true);
                            setError("");
                            setNotice("");
                          }}
                        >
                          Forgotten your password?
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
