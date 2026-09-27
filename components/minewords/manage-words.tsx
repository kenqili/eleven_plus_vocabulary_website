"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";

type Excluded = { id: string; word: string };
type Added = {
  id: string;
  word: string;
  definition: string;
  example: string;
  alreadyInBank: boolean;
  difficulty: number | null;
};
type Snapshot = {
  excluded: Excluded[];
  added: Added[];
  limits: { maxAddedWords: number };
};

const empty: Snapshot = { excluded: [], added: [], limits: { maxAddedWords: 500 } };

export default function ManageWordsPage() {
  const [data, setData] = useState<Snapshot>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ word: "", definition: "", example: "" });

  useEffect(() => {
    let active = true;
    api<Snapshot>("/api/parent-words")
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your words.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const send = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await api<Snapshot>("/api/parent-words", body));
      setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  const full = data.added.length >= data.limits.maxAddedWords;

  return (
    <div className="site">
      <Header />
      <main className="workspace prose-workspace">
        <section className="page-hero">
          <div>
            <div className="eyebrow">PARENT SETTINGS</div>
            <h1>Choose the words your child practises.</h1>
            <p>
              Set aside anything that is too easy, too hard, or simply not
              useful right now, and add words from your own lessons, reading
              books or family. Your changes apply to the word list and to
              practice straight away.
            </p>
            <Link className="primary-button" href="/words">
              Back to the word list
            </Link>
          </div>
        </section>

        {!loaded ? (
          <p className="muted">Loading your settings…</p>
        ) : error ? (
          <p className="manage-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="manage-notice" role="status">
            {notice}
          </p>
        ) : null}

        <section className="manage-section">
          <h2>
            <Plus size={20} aria-hidden /> Add your own words
          </h2>
          <p className="manage-hint">
            A word, what it means, and a sentence that shows it being used. That
            is enough for it to appear in your child&rsquo;s word list and in
            practice. You can keep {data.limits.maxAddedWords} of your own; you
            have {data.added.length}.
          </p>
          <form
            className="manage-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send({ action: "add", ...form }, "Word added.").then(() =>
                setForm({ word: "", definition: "", example: "" }),
              );
            }}
          >
            <label htmlFor="own-word">Word</label>
            <input
              id="own-word"
              maxLength={60}
              required
              value={form.word}
              onChange={(event) =>
                setForm({ ...form, word: event.target.value })
              }
              placeholder="quaff"
            />
            <label htmlFor="own-definition">What it means</label>
            <input
              id="own-definition"
              maxLength={200}
              required
              value={form.definition}
              onChange={(event) =>
                setForm({ ...form, definition: event.target.value })
              }
              placeholder="To drink something, usually in a noisy way."
            />
            <label htmlFor="own-example">A sentence using it</label>
            <input
              id="own-example"
              maxLength={240}
              required
              value={form.example}
              onChange={(event) =>
                setForm({ ...form, example: event.target.value })
              }
              placeholder="They quaffed the lemonade and made a face."
            />
            <button
              className="primary-button"
              type="submit"
              disabled={busy || full}
            >
              {full ? "Limit reached" : "Add word"}
            </button>
          </form>
        </section>

        <section className="manage-section">
          <h2>
            <EyeOff size={20} aria-hidden /> Your own words ({data.added.length})
          </h2>
          {!data.added.length ? (
            <p className="muted">You have not added any words yet.</p>
          ) : (
            <ul className="manage-list">
              {data.added.map((row) => (
                <li key={row.id} className="manage-row">
                  <div>
                    <strong>{row.word}</strong>
                    {row.alreadyInBank ? (
                      <span className="soft-chip">We already teach this</span>
                    ) : null}
                    <p>{row.definition}</p>
                    {row.example ? <em>{row.example}</em> : null}
                  </div>
                  <button
                    type="button"
                    className="manage-action"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        { action: "remove", id: row.id },
                        `${row.word} removed.`,
                      )
                    }
                  >
                    <Trash2 size={15} aria-hidden /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="manage-section">
          <h2>
            <EyeOff size={20} aria-hidden /> Set aside ({data.excluded.length})
          </h2>
          <p className="manage-hint">
            These words are hidden from the word list and never come up in
            practice. Progress already recorded is kept, so bringing a word
            back does not start it from zero.
          </p>
          {!data.excluded.length ? (
            <p className="muted">No words are set aside.</p>
          ) : (
            <ul className="manage-chips">
              {data.excluded.map((row) => (
                <li key={row.id} className="manage-chip">
                  <span>{row.word}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        { action: "restore", wordId: row.id },
                        `${row.word} is back in the list.`,
                      )
                    }
                  >
                    <RotateCcw size={13} aria-hidden /> Bring back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
