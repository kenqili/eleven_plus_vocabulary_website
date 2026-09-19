"use client";
import { BookOpen, ArrowRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import Header from "./header";
import ProgressPanel from "./progress-panel";
import WordExplanation from "./word-explanation";
import { useChallenge } from "./use-challenge";
export default function Challenge() {
  const study = useChallenge();
  const { question, feedback, stats, demo, busy, error } = study;
  return (
    <div className="site">
      <Header />
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">LEARN A LITTLE EVERY DAY</div>
            <h1>11+ Vocabulary Challenge</h1>
            <p>Build your vocabulary, one word at a time.</p>
          </div>
          <span className="edition">
            <BookOpen size={16} /> Vocabulary practice
          </span>
        </div>
        <div className="study-layout">
          <section>
            <div className="session-bar">
              <span>{demo ? "TRY FIVE WORDS" : "YOUR PRACTICE"}</span>
              <span>Choose the definition</span>
            </div>
            <article className="question-card" aria-busy={busy}>
              {question ? (
                <>
                  <div className="question-meta">
                    <span>WORD {String(question.number).padStart(2, "0")}</span>
                    <span className="pill">
                      {question.seen <= 1
                        ? "New word"
                        : `Seen ${question.seen} times`}
                    </span>
                  </div>
                  <h2>{question.word}</h2>
                  <p>Which definition matches this word?</p>
                  <div className="answers">
                    {question.choices.map((choice, i) => (
                      <button
                        key={`${question.id}-${i}`}
                        className={`answer ${feedback && choice === feedback.definition ? "correct" : ""} ${feedback && feedback.selected === i && !feedback.correct ? "incorrect" : ""}`}
                        disabled={busy || Boolean(feedback)}
                        onClick={() => void study.answer(i)}
                      >
                        <span>{String.fromCharCode(65 + i)}</span>
                        {choice}
                        {feedback && choice === feedback.definition && (
                          <span aria-label="Correct answer">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {feedback && (
                    <div className="feedback" role="status">
                      <strong>
                        {feedback.correct
                          ? "Correct. Nicely done!"
                          : feedback.skipped
                            ? "Take a moment to learn this one."
                            : "Not quite. Here’s the meaning."}
                      </strong>
                      <WordExplanation word={feedback} />
                      {!demo && !feedback.correct && (
                        <small>
                          This word will return after 5–20 other questions,
                          where enough words remain.
                        </small>
                      )}
                    </div>
                  )}
                  <div className="question-footer">
                    <span>
                      {Math.min(
                        3,
                        question.correctCount + (feedback?.correct ? 1 : 0),
                      )}{" "}
                      of 3 correct to master this word
                    </span>
                    {feedback ? (
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void study.next()}
                      >
                        Next word <ArrowRight size={16} />
                      </button>
                    ) : (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void study.answer(-1)}
                      >
                        Skip & reveal <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                </>
              ) : study.complete ? (
                <div className="empty-state">
                  <div className="eyebrow">
                    {demo ? "SAMPLE COMPLETE" : "CHALLENGE COMPLETE"}
                  </div>
                  <h2>
                    {demo ? "Keep discovering." : "Every word, mastered."}
                  </h2>
                  <p>
                    {demo
                      ? "Make the full word collection part of your routine. Create an account to explore membership."
                      : "You have answered every word correctly three times. Excellent work."}
                  </p>
                  {demo && (
                    <a className="primary-button" href="/account">
                      Create your account →
                    </a>
                  )}
                </div>
              ) : (
                <div className="loading" role="status">
                  {error
                    ? "Practice could not be loaded."
                    : "Opening your word challenge…"}
                </div>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                  {!question && (
                    <button
                      className="text-button"
                      onClick={() => void study.reload()}
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
            </article>
            <div className="control-row">
              <label style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Checkbox
                  checked={study.autoNext}
                  onCheckedChange={(value) => study.setAutoNext(value === true)}
                />
                Auto-next when correct
              </label>
              <span className="muted">
                {demo
                  ? "Sample progress is not saved"
                  : "Progress saved to your account"}
              </span>
            </div>
            {study.previous && (
              <details className="previous-review">
                <summary>Review previous word</summary>
                <p>
                  <strong>{study.previous.word}</strong>
                </p>
                <WordExplanation word={study.previous} />
                <small>Review only. Your score stays the same.</small>
              </details>
            )}
          </section>
          <ProgressPanel stats={stats} demo={demo} />
        </div>
        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>11+ VOCABULARY CHALLENGE</span>
        </footer>
      </main>
    </div>
  );
}
