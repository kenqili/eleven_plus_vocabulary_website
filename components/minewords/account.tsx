"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";
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
  price: {
    unit_amount: number;
    currency: string;
    recurring: { interval: string };
  } | null;
};
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
  function refresh() {
    return api<{
      user: User | null;
      freeTrialDays: number;
      freeWordLimit: number;
    }>(
      "/api/auth/me",
    ).then(async (result) => {
      setUser(result.user);
      setTrialDays(result.freeTrialDays);
      setFreeWordLimit(result.freeWordLimit);
      setBilling(
        result.user ? await api<Billing>("/api/billing/status") : null,
      );
    });
  }
  useEffect(() => {
    void refresh()
      .then(() => {
        const checkout = new URLSearchParams(window.location.search).get(
          "checkout",
        );
        if (checkout === "success")
          setNotice(
            "Payment submitted. Your membership will appear after payment confirmation.",
          );
        if (checkout === "cancelled")
          setNotice("Checkout cancelled. You can still try the sample words.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${register ? "register" : "login"}`, {
        email,
        password,
      });
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pay(action: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/billing/${action}`, {});
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", {});
      setUser(null);
      setBilling(null);
      setNotice("You are signed out.");
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
                  <p className="muted">
                    Access through{" "}
                    {new Date(billing.periodEnd! * 1000).toLocaleDateString()}.
                  </p>
                  <Link className="primary-button" href="/">
                    Continue practising →
                  </Link>
                </>
              ) : (
                <>
                  {billing?.price && (
                    <h2>
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: billing.price.currency,
                      }).format(billing.price.unit_amount / 100)}{" "}
                      <small>/ month</small>
                    </h2>
                  )}
                  <p className="muted">
                    {billing?.trialExpired
                      ? `Your full-access trial has ended. Continue with the ${freeWordLimit}-word free collection, or subscribe to unlock every word and revision export. Your saved progress is safe.`
                      : "Your free account includes full access for " +
                        (billing?.trialDays ?? 7) +
                        " days after sign-up. Upgrade any time to keep practising afterwards."}
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy || !billing?.ready}
                    onClick={() => void pay("checkout")}
                  >
                    {busy ? "Please wait…" : "Subscribe monthly"}
                  </button>
                  {billing && !billing.ready && (
                    <p className="muted">
                      Subscriptions are not open yet. Your saved learning
                      progress remains available.
                    </p>
                  )}
                </>
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
            </>
          ) : (
            <>
              <h1>{register ? "Start your word journey." : "Welcome back."}</h1>
              <p className="muted">
                {register
                  ? `Create a free account for ${trialDays} days of full access, then subscribe to keep practising.`
                  : "Sign in to continue your vocabulary practice."}
              </p>
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
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={12}
                  maxLength={128}
                />
                <p className="muted">Use at least 12 characters.</p>
                <button className="primary-button" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : register
                      ? "Create account"
                      : "Sign in"}
                </button>
              </form>
              <p className="muted">
                {register ? "Already have an account?" : "New to MineWords?"}{" "}
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
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="feedback" role="status">
              {notice}
            </p>
          )}
        </section>
      </main>
    </>
  );
}
