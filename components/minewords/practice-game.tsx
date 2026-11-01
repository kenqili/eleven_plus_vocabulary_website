"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { TYPE_BUTTONS } from "@/lib/challenge/config";
import type { PracticeGameQuestion } from "@/lib/challenge/practice-game";
import type {
  RelationFinish,
  RelationMatch,
  RelationResult,
} from "@/lib/challenge/relations";
import { shuffle } from "@/lib/challenge/words";
import { formatMatchSeconds } from "@/lib/games";
import MatchHistory from "./match-history";
import WordCard from "./word-card";

/**
 * The mixed-practice game: ten of the practice questions, then a score.
 *
 * It is deliberately the same shape as the relation challenge - one question
 * at a time, marked locally, written once at the end - so the two games share
 * the history panel, the match claim and the correctness rules. What differs
 * is the question: a single answer from four options, of any practice type,
 * rather than a set of synonyms or antonyms.
 */

type GameState = {
  kind: "mi";
  questions: PracticeGameQuestion[];
  history: RelationMatch[];
  level: number | null;
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

export default function PracticeGame({
  demoQuestions,
}: {
  demoQuestions: PracticeGameQuestion[];
}) {
  const [questions, setQuestions] = useState<PracticeGameQuestion[]>([]);
  const [history, setHistory] = useState<RelationMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<RelationResult[]>([]);
  const [submissions, setSubmissions] = useState<
    { wordId: string; type: string; selected: string }[]
  >([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [matchId, setMatchId] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [level, setLevel] = useState<number | null>(null);

  const start = useCallback(async () => {
    setLoading(true);
    setError("");
    setSummary(null);
    setResults([]);
    setSubmissions([]);
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setMatchId(newMatchId());
    try {
      const state = await api<GameState>("/api/games?kind=mi");
      setQuestions(state.questions);
      setHistory(state.history);
      setLevel(state.level);
      setGuest(false);
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) {
        // A signed-out visitor still gets a game, built on the server from the
        // free collection. Nothing is written down.
        setGuest(true);
        setQuestions(shuffle(demoQuestions));
        setHistory([]);
        setLevel(null);
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : "The game could not start. Please try again.",
        );
      }
    } finally {
      setStartedAt(Date.now());
      setLoading(false);
    }
  }, [demoQuestions]);

  useEffect(() => {
    const timer = setTimeout(() => void start(), 0);
    return () => clearTimeout(timer);
  }, [start]);

  const current = questions[index];
  const total = questions.length;
  const scoreSoFar = results.filter((result) => result.correct).length;
  const last = results[results.length - 1];

  const choose = useCallback(
    (option: string) => {
      if (checked || summary) return;
      setSelected(option);
    },
    [checked, summary],
  );

  const check = useCallback(() => {
    const question = questions[index];
    if (!question || checked || summary || selected === null) return;
    const correct = selected === question.answer;
    setChecked(true);
    setResults((current) => [
      ...current,
      { wordId: question.wordId, word: question.word, correct },
    ]);
    setSubmissions((current) => [
      ...current,
      { wordId: question.wordId, type: question.type, selected },
    ]);
  }, [questions, index, checked, summary, selected]);

  const finish = useCallback(async () => {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
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
        kind: "mi",
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
  }, [startedAt, results, guest, matchId, submissions]);

  const next = useCallback(() => {
    if (summary) return;
    if (!checked) {
      check();
      return;
    }
    if (index + 1 < questions.length) {
      setIndex((current) => current + 1);
      setSelected(null);
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
      if (event.key === "Enter" || event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }
      if (!/^[a-d]$/i.test(event.key) || checked || summary) return;
      const option =
        questions[index]?.choices[
          event.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0)
        ];
      if (!option) return;
      event.preventDefault();
      choose(option);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, choose, questions, index, checked, summary]);

  return (
    <div className="relation-page">
      <div className="relation-hero">
        <div>
          <p className="eyebrow">Games</p>
          <h1>Mi Challenge</h1>
          <p>
            Ten mixed questions from your practice words: meanings, similar
            words, opposites, name the word and fill the gap.
          </p>
        </div>
        <div className="relation-badges">
          {guest ? <span className="relation-pill is-guest">Guest</span> : null}
          {level !== null ? (
            <span className="relation-pill">Level {level}</span>
          ) : null}
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
                You took {formatMatchSeconds(summary.seconds)}.
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
                  No correctness this time. Try the words again in practice.
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
              <p className="relation-kicker">{TYPE_BUTTONS[current.type]}</p>
              <h2 className="relation-prompt">{current.prompt}</h2>
              <p className="relation-instruction">
                Pick one answer. Use the letter keys.
              </p>
              <div className="relation-options practice-options">
                {current.choices.map((choice, optionIndex) => {
                  const isSelected = selected === choice;
                  const isAnswer = choice === current.answer;
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
                      key={choice}
                      type="button"
                      className={`relation-option practice-option ${state}`.trim()}
                      onClick={() => choose(choice)}
                      disabled={checked}
                      aria-pressed={isSelected}
                    >
                      <span className="relation-key">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="relation-option-text">{choice}</span>
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
                      ? "Correct."
                      : `Not quite. The answer is “${current.answer}”.`}
                  </p>
                  <WordCard word={current} />
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
                    <kbd>Enter</kbd> or <kbd>→</kbd>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="relation-primary"
                    onClick={check}
                    disabled={selected === null}
                  >
                    Check <kbd>Enter</kbd> or <kbd>→</kbd>
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

        <MatchHistory
          history={history}
          loading={loading}
          guest={guest}
          intro="The last ten rounds of mixed practice."
          howTo={
            <p>
              Press <kbd>A</kbd>–<kbd>D</kbd> to choose an answer, and{" "}
              <kbd>Enter</kbd> or <kbd>→</kbd> to check. Answer every question
              to score the word.
            </p>
          }
        />
      </div>
    </div>
  );
}
