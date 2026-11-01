"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import {
  gradeSelection,
  relationLabel,
  type RelationFinish,
  type RelationKind,
  type RelationMatch,
  type RelationQuestion,
  type RelationResult,
} from "@/lib/challenge/relations";
import { shuffle } from "@/lib/challenge/words";

/**
 * One component, two games.
 *
 * The synonym challenge and the antonym challenge differ in a single word of
 * instruction and a single list in the bank, so they are the same component
 * with a `kind`. Writing them twice would mean fixing every keyboard bug twice
 * and letting one of them drift.
 *
 * The browser marks the questions and reports the picks; the server grades the
 * same picks again from the bank and is the only thing that can award a
 * correctness. The questions arrive with their answers because the marking is
 * local and instant, which is the same trade Five Letters makes: this is a
 * game, not an exam, and the endpoint does not trust the report either way.
 */

type GameState = {
  kind: RelationKind;
  questions: RelationQuestion[];
  history: RelationMatch[];
};

type Summary = {
  score: number;
  questions: number;
  seconds: number;
  awarded: number;
};

const newMatchId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const formatSeconds = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

const formatDate = (time: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(time),
  );

function WordCard({ question }: { question: RelationQuestion }) {
  return (
    <div className="relation-card-details">
      <p className="relation-definition">{question.definition}</p>
      {question.example ? (
        <p className="relation-example">“{question.example}”</p>
      ) : null}
      <div className="relation-relations">
        <div>
          <span className="relation-relation-label">Synonyms</span>
          {question.synonyms.length ? (
            <ul>
              {question.synonyms.map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ul>
          ) : (
            <p className="relation-none">None recorded.</p>
          )}
        </div>
        <div>
          <span className="relation-relation-label">Antonyms</span>
          {question.antonyms.length ? (
            <ul>
              {question.antonyms.map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ul>
          ) : (
            <p className="relation-none">None recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RelationChallenge({
  kind,
  demoQuestions,
}: {
  kind: RelationKind;
  demoQuestions: RelationQuestion[];
}) {
  const [questions, setQuestions] = useState<RelationQuestion[]>([]);
  const [history, setHistory] = useState<RelationMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<RelationResult[]>([]);
  const [submissions, setSubmissions] = useState<
    { wordId: string; selected: string[] }[]
  >([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [matchId, setMatchId] = useState("");
  const [startedAt, setStartedAt] = useState(0);

  const start = useCallback(async () => {
    setLoading(true);
    setError("");
    setSummary(null);
    setResults([]);
    setSubmissions([]);
    setIndex(0);
    setSelected([]);
    setChecked(false);
    setMatchId(newMatchId());
    try {
      const state = await api<GameState>(`/api/games?kind=${kind}`);
      setQuestions(state.questions);
      setHistory(state.history);
      setGuest(false);
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) {
        // A signed-out visitor still gets a game. The sample is built on the
        // server from the free collection, so it is the same words they can
        // practise, and nothing is written down.
        setGuest(true);
        setQuestions(shuffle(demoQuestions));
        setHistory([]);
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : "The game could not start. Please try again.",
        );
      }
    } finally {
      // The clock starts when the child can see a question, not when the
      // request left: a slow connection should not be part of the match time.
      setStartedAt(Date.now());
      setLoading(false);
    }
  }, [kind, demoQuestions]);

  useEffect(() => {
    // Deferred a turn so the first render paints before the request's state
    // updates start, the same way Five Letters starts a round.
    const timer = setTimeout(() => void start(), 0);
    return () => clearTimeout(timer);
  }, [start]);

  const current = questions[index];
  const total = questions.length;
  const scoreSoFar = results.filter((result) => result.correct).length;
  const last = results[results.length - 1];

  const toggle = useCallback(
    (option: string) => {
      if (checked || summary) return;
      setSelected((current) => {
        if (current.includes(option))
          return current.filter((word) => word !== option);
        if (current.length >= (questions[index]?.selectCount ?? 0))
          return current;
        return [...current, option];
      });
    },
    [checked, summary, questions, index],
  );

  const check = useCallback(() => {
    const question = questions[index];
    if (!question || checked || summary) return;
    if (selected.length !== question.selectCount) return;
    const correct = gradeSelection(selected, question.answers);
    setChecked(true);
    setResults((current) => [
      ...current,
      { wordId: question.wordId, word: question.word, correct },
    ]);
    setSubmissions((current) => [
      ...current,
      { wordId: question.wordId, selected },
    ]);
  }, [questions, index, checked, summary, selected]);

  const finish = useCallback(async () => {
    const seconds = Math.max(
      1,
      Math.round((Date.now() - startedAt) / 1000),
    );
    const score = results.filter((result) => result.correct).length;
    if (guest) {
      setSummary({
        score,
        questions: results.length,
        seconds,
        awarded: 0,
      });
      return;
    }
    setBusy(true);
    try {
      const state = await api<RelationFinish>("/api/games", {
        kind,
        matchId,
        answers: submissions,
        seconds,
      });
      setSummary({
        score: state.score,
        questions: state.questions,
        seconds: state.seconds,
        awarded: state.awarded,
      });
      setHistory(state.history);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The score could not be saved.",
      );
      // The child did the work; show the result even when the write failed.
      setSummary({ score, questions: results.length, seconds, awarded: 0 });
    } finally {
      setBusy(false);
    }
  }, [startedAt, results, guest, kind, matchId, submissions]);

  const next = useCallback(() => {
    if (summary) return;
    if (!checked) {
      check();
      return;
    }
    if (index + 1 < questions.length) {
      setIndex((current) => current + 1);
      setSelected([]);
      setChecked(false);
      return;
    }
    void finish();
  }, [summary, checked, check, index, questions.length, finish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        next();
        return;
      }
      if (!/^[a-f]$/i.test(event.key) || checked || summary) return;
      const option =
        questions[index]?.options[
          event.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0)
        ];
      if (!option) return;
      event.preventDefault();
      toggle(option);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, toggle, questions, index, checked, summary]);

  const title = kind === "syn" ? "Synonym Challenge" : "Antonym Challenge";

  return (
    <div className="relation-page">
      <div className="relation-hero">
        <div>
          <p className="eyebrow">Games</p>
          <h1>{title}</h1>
          <p>
            Pick the {relationLabel(kind, 3)} of each word. Ten rounds, then
            your score.
          </p>
        </div>
        <div className="relation-badges">
          {guest ? <span className="relation-pill is-guest">Guest</span> : null}
          <span className="relation-pill">
            {loading
              ? "Getting ready"
              : summary
                ? "Match complete"
                : `${Math.min(index + 1, total)} of ${total}`}
          </span>
          <span className="relation-pill">{scoreSoFar} right</span>
        </div>
      </div>

      <div className="relation-layout">
        <section className="relation-card" aria-live="polite">
          {loading ? (
            <p className="relation-loading">Setting up your game…</p>
          ) : summary ? (
            <>
              <p className="relation-kicker">Match complete</p>
              <h2 className="relation-summary-score">
                {summary.score} / {summary.questions}
              </h2>
              <p className="relation-summary-line">
                You took {formatSeconds(summary.seconds)}.
              </p>
              {guest ? (
                <p className="relation-note">
                  Sign in to save your scores and count these words towards
                  mastery.
                </p>
              ) : summary.awarded ? (
                <p className="relation-note">
                  {summary.awarded}{" "}
                  {summary.awarded === 1 ? "word" : "words"} gained a
                  correctness.
                </p>
              ) : summary.score ? (
                <p className="relation-note">
                  Every word you got right is already mastered.
                </p>
              ) : (
                <p className="relation-note">
                  No correctness this time. Every word needs all of its{" "}
                  {relationLabel(kind, 2)}.
                </p>
              )}
              <ul className="relation-results">
                {results.map((result) => (
                  <li
                    key={result.wordId}
                    className={result.correct ? "is-right" : "is-wrong"}
                  >
                    <span>{result.word}</span>
                    <span>{result.correct ? "Right" : "Missed"}</span>
                  </li>
                ))}
              </ul>
              {error ? (
                <p className="relation-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="relation-actions">
                <button
                  type="button"
                  className="relation-primary"
                  onClick={() => void start()}
                  disabled={busy}
                >
                  Play again
                </button>
              </div>
            </>
          ) : current ? (
            <>
              <p className="relation-kicker">
                {checked
                  ? "Answer"
                  : kind === "syn"
                    ? "Which words mean the same?"
                    : "Which words mean the opposite?"}
              </p>
              <h2 className="relation-word">{current.word}</h2>
              <p className="relation-instruction">
                Select {current.selectCount}{" "}
                {relationLabel(kind, current.selectCount)}
                {current.selectCount < 3
                  ? ` — the word has only ${current.selectCount}.`
                  : "."}{" "}
                {selected.length
                  ? `${selected.length} chosen.`
                  : "Use the letter keys."}
              </p>
              <div className="relation-options">
                {current.options.map((option, optionIndex) => {
                  const isSelected = selected.includes(option);
                  const isAnswer = current.answers.some(
                    (answer) =>
                      answer.toLowerCase() === option.toLowerCase(),
                  );
                  const state = checked
                    ? isAnswer
                      ? "is-correct"
                      : isSelected
                        ? "is-wrong"
                        : "is-missed"
                    : isSelected
                      ? "is-selected"
                      : "";
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`relation-option ${state}`.trim()}
                      onClick={() => toggle(option)}
                      disabled={checked}
                      aria-pressed={isSelected}
                    >
                      <span className="relation-key">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="relation-option-text">{option}</span>
                      {checked && isAnswer ? (
                        <span className="relation-mark" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {checked ? (
                <>
                  <p
                    className={`relation-feedback ${last?.correct ? "is-right" : "is-wrong"}`}
                    role="status"
                  >
                    {last?.correct
                      ? "All correct."
                      : "Not quite. The right answers are highlighted."}
                  </p>
                  <WordCard question={current} />
                </>
              ) : null}
              <div className="relation-actions">
                {checked ? (
                  <button
                    type="button"
                    className="relation-primary"
                    onClick={next}
                  >
                    {index + 1 < total ? "Next word" : "See your score"}{" "}
                    <kbd>Enter</kbd>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="relation-primary"
                    onClick={check}
                    disabled={selected.length !== current.selectCount}
                  >
                    Check <kbd>Enter</kbd>
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="relation-kicker">Nothing to play</p>
              <p className="relation-note">
                {error ||
                  "There are no words to play with yet. Try again in a moment."}
              </p>
              <div className="relation-actions">
                <button
                  type="button"
                  className="relation-primary"
                  onClick={() => void start()}
                >
                  Try again
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="relation-history">
          <h2>Your matches</h2>
          <p className="relation-history-intro">
            The last ten rounds on this challenge.
          </p>
          {loading ? (
            <p className="relation-history-empty">Loading your matches…</p>
          ) : guest ? (
            <p className="relation-history-empty">
              Sign in to keep a history.
            </p>
          ) : history.length ? (
            <ol className="relation-history-list">
              {history.map((match) => (
                <li key={match.id}>
                  <span className="relation-history-score">
                    {match.score}/{match.questions}
                  </span>
                  <span className="relation-history-time">
                    {formatSeconds(match.seconds)}
                  </span>
                  <span className="relation-history-date">
                    {formatDate(match.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="relation-history-empty">
              No matches yet. This is your first.
            </p>
          )}
          <div className="relation-howto">
            <h3>How to play</h3>
            <p>
              Press <kbd>A</kbd>–<kbd>F</kbd> to choose a word, and{" "}
              <kbd>Enter</kbd> to check. Select every {relationLabel(kind)}{" "}
              to score the word.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
