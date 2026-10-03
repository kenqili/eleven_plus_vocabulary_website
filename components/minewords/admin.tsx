"use client";

/**
 * The administrator's page: issue codes, and see how many have gone.
 *
 * Rendered for everyone who asks for `/admin`, and shows nothing useful to anyone
 * who is not the administrator - the API answers 404 to them, so there is no
 * second check here that could disagree with the first. A client-side gate would
 * be a comment about a security boundary rather than one, and this one is the
 * server's job alone.
 *
 * Codes are shown once, in full, and are not fetchable again afterwards. They
 * cannot be: they are stored as the parent types them, not as a hash, because a
 * parent has to be able to type one. So this is the only moment they are ever
 * displayed, which is what the copy below is for.
 */
import { useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";

const LENGTHS = [
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
];

export default function AdminPage() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [stats, setStats] = useState<{
    issued: number;
    redeemed: number;
    batches: {
      batch: string;
      days: number;
      issued: number;
      redeemed: number;
    }[];
  } | null>(null);

  async function load() {
    try {
      // No second argument. `api(path, data)` sends a POST for any truthy
      // `data`, and `{}` is truthy - so passing it turned this read into a POST,
      // which is the action that issues a batch. The counts panel could therefore
      // never render, every batch burned two of the ten rate-limit slots instead
      // of one, and the administrator saw "Choose a length." under a batch that
      // had just succeeded.
      setStats(await api("/api/admin"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load that.");
    }
  }

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ codes: string[] }>("/api/admin", { days });
      setCodes(result.codes);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="workspace">
        <h1 className="workspace-title">
          <ShieldCheck size={22} aria-hidden /> Administrator
        </h1>

        <section className="manage-panel">
          <h2>Issue coupon codes</h2>
          <p className="muted">
            Thirty-two codes at a time, each worth the same length. These are
            hardship codes: issue one to a family who has told you the cost is a
            problem, and they enter it on their account page to keep their
            child&apos;s access going. A code works once.
          </p>
          <div className="account-actions">
            {LENGTHS.map((length) => (
              <label key={length.days} className="radio-option">
                <input
                  type="radio"
                  name="days"
                  value={length.days}
                  checked={days === length.days}
                  onChange={() => setDays(length.days)}
                />
                {length.label}
              </label>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-actions">
            <button className="primary-button" disabled={busy} onClick={issue}>
              Generate 32 codes
            </button>
            {stats && (
              <button className="text-button" onClick={() => void load()}>
                Refresh counts
              </button>
            )}
          </div>

          {codes && (
            <div className="coupon-codes">
              {/* role="status" so a screen reader hears the codes exist without
                  having to find them, and because a sighted admin generating a
                  batch needs the same announcement. */}
              <p role="status">
                {codes.length} codes generated. They are shown once and cannot
                be shown again - copy them now.
              </p>
              <textarea
                readOnly
                rows={8}
                value={codes.join("\n")}
                aria-label="Generated coupon codes"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="account-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(codes.join("\n"));
                  }}
                >
                  Copy all
                </button>
                <button className="text-button" onClick={() => setCodes(null)}>
                  Hide
                </button>
              </div>
            </div>
          )}
        </section>

        {stats && (
          <section className="manage-panel">
            <h2>Issued so far</h2>
            <p className="muted">
              {stats.issued} codes issued, {stats.redeemed} redeemed.
            </p>
            <div className="word-table-wrap">
              <table className="word-table">
                <thead>
                  <tr>
                    <th scope="col">Length</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Redeemed</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.batches.map((row) => (
                    <tr key={row.batch}>
                      <td>{row.days} days</td>
                      <td>{row.issued}</td>
                      <td>{row.redeemed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="muted">
          <Link href="/account" className="text-button">
            <KeyRound size={15} aria-hidden /> Back to your account
          </Link>
        </p>
      </main>
    </>
  );
}
