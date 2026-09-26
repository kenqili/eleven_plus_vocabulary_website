"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Header from "./header";
import { api } from "@/lib/client/api";
import {
  BADGES,
  type Receipt,
  type Transaction,
  type RewardSummary,
} from "@/lib/challenge/rewards";
type Data = {
  rewards: RewardSummary;
  totalEarned: number;
  collection: Record<string, number>;
  receipts: Receipt[];
  transactions: Transaction[];
  more: boolean;
  nextOffset: number;
};
const date = (value: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
export default function Rewards() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const request = useRef<{ badgeId: string; key: string } | null>(null);
  function refresh() {
    return api<Data>("/api/rewards").then(setData);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const focus = () => {
      void refresh().catch((e) => setError(e.message));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  async function redeem() {
    if (!chosen || busy) return;
    if (!request.current || request.current.badgeId !== chosen)
      request.current = { badgeId: chosen, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await api<Data & { receipt: Receipt }>("/api/rewards", {
        action: "redeem",
        badgeId: chosen,
        requestKey: request.current.key,
      });
      setData(result);
      setNotice(`${result.receipt.badge_name} added to your collection!`);
      setChosen(null);
      request.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const next = await api<Data>(`/api/rewards?offset=${data.nextOffset}`);
      setData({
        ...next,
        receipts: [...data.receipts, ...next.receipts],
        transactions: [...data.transactions, ...next.transactions],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nextBadge = data
    ? BADGES.find((item) => !data.collection[item.id])
    : undefined;
  const badge = BADGES.find((item) => item.id === chosen);
  return (
    <>
      <Header />
      <main className="workspace rewards-workspace">
        <Link className="text-button" href="/">
          ← Back to practice
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR EARNED REWARDS</div>
            <h1>Small wins, worth keeping.</h1>
            <p>Collect digital badges with your learning credits.</p>
          </div>
          {data && (
            <div className="credit-balance">
              <strong>{data.rewards.balance}</strong> credits available to spend
              <small>{data.totalEarned} total credits earned</small>
            </div>
          )}
        </div>
        <p>
          These are digital badges. Parents decide whether to celebrate them
          with a reward at home. We keep your redemption record.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            {!data && (
              <>
                <Link href="/account">Sign in</Link> or{" "}
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    void refresh().catch((e) => setError(e.message));
                  }}
                >
                  try again
                </button>
                .
              </>
            )}
          </div>
        )}
        {!data && !error && <p role="status">Loading your credits…</p>}
        {notice && (
          <p className="reward-notice" role="status">
            {notice}
          </p>
        )}
        {data && (
          <>
            <div className="collection-goal" role="status">
              {nextBadge
                ? data.rewards.balance >= nextBadge.cost
                  ? `${nextBadge.name} is ready to collect!`
                  : `${nextBadge.cost - data.rewards.balance} more credits to collect ${nextBadge.name}`
                : "You’ve collected every badge! You can collect your favourites again."}
            </div>
            <div className="badge-grid">
              {BADGES.map((item) => (
                <article
                  className={`badge-card ${data.collection[item.id] ? "badge-collected" : "badge-uncollected"}`}
                  key={item.id}
                >
                  <div className="badge-symbol" aria-hidden="true">
                    {item.symbol}
                  </div>
                  <h2>{item.name}</h2>
                  <p>
                    {data.collection[item.id]
                      ? `Collected ×${data.collection[item.id]}`
                      : "Not collected yet"}
                  </p>
                  <p>{item.cost} credits</p>
                  <button
                    className="primary-button"
                    disabled={busy || data.rewards.balance < item.cost}
                    onClick={() => {
                      setChosen(item.id);
                      setError("");
                    }}
                  >
                    {data.rewards.balance < item.cost
                      ? `${item.cost - data.rewards.balance} more to earn`
                      : data.collection[item.id]
                        ? "Collect again"
                        : "Choose badge"}
                  </button>
                </article>
              ))}
            </div>
            {badge && (
              <section
                className="redemption-confirm"
                aria-label="Confirm badge redemption"
              >
                <h2>Redeem {badge.name}?</h2>
                <p>
                  Spend {badge.cost} credits. You’ll have{" "}
                  {data.rewards.balance - badge.cost} credits left.
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void redeem()}
                >
                  {busy ? "Saving…" : "Redeem badge"}
                </button>{" "}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setChosen(null)}
                >
                  Cancel
                </button>
              </section>
            )}
            <details className="history-panel">
              <summary>Badge receipts</summary>
              {!data.receipts.length ? (
                <p>Your first badge is waiting. Keep practising!</p>
              ) : (
                <ul className="receipt-list">
                  {data.receipts.map((item) => (
                    <li key={item.id}>
                      <strong>{item.badge_name}</strong>
                      <span>
                        {item.cost} credits · {date(item.created_at)} (London)
                      </span>
                      <small>Receipt: {item.id}</small>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <details className="history-panel">
              <summary>Credit history</summary>
              <p>
                +2 per correct answer, +5 for every three correct in a row, +10
                for mastering a word, and +10 for each story’s first completion.
                Mistakes never take away credits.
              </p>
              {!data.transactions.length ? (
                <p>Your earned credits will appear here.</p>
              ) : (
                <ul className="receipt-list">
                  {data.transactions.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.amount > 0 ? "+" : ""}
                        {item.amount} credits ·{" "}
                        {item.reason === "story"
                          ? "Story completed"
                          : item.reason === "badge"
                            ? "Badge redeemed"
                            : "Learning award"}
                      </strong>
                      {item.reason === "learning" && (
                        <span>
                          {[
                            item.base ? `+${item.base} correct` : null,
                            item.streak ? `+${item.streak} streak` : null,
                            item.mastery ? `+${item.mastery} mastered` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      <span>
                        {date(item.created_at)} (London) · balance{" "}
                        {item.balance_after}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            {data.more && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void more()}
              >
                Load older history
              </button>
            )}
          </>
        )}
      </main>
    </>
  );
}
