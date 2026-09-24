"use client";
import { useEffect } from "react";
import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MASTERY_TARGET,
  QUESTION_TYPES,
  TYPE_LABELS,
  type QuestionType,
} from "@/lib/challenge/config";
import Header from "./header";
import ProgressPanel from "./progress-panel";
import WordExplanation from "./word-explanation";
import { useChallenge } from "./use-challenge";
export default function Challenge() {
  const study = useChallenge();
  const { question, feedback, stats, demo, busy, error } = study;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      const key = event.key.toLowerCase();
      const answerIndex = /^[a-d]$/.test(key)
        ? key.charCodeAt(0) - 97
        : /^[1-4]$/.test(key)
          ? Number(key) - 1
          : -1;
      if (
        answerIndex >= 0 &&
        question &&
        !feedback &&
        !busy &&
        !study.historical
      ) {
        event.preventDefault();
        void study.answer(answerIndex);
      } else if (key === "arrowleft" && study.hasPrevious) {
        event.preventDefault();
        study.goPrevious();
      } else if (
        key === "arrowright" &&
        (study.historical || Boolean(feedback))
      ) {
        event.preventDefault();
        void study.next();
      } else if (
        (key === " " || key === "enter") &&
        (study.historical || Boolean(feedback)) &&
        !(target instanceof HTMLElement && target.closest("button, a"))
      ) {
        event.preventDefault();
        void study.next();
      } else if (
        key === "enter" &&
        question &&
        !feedback &&
        !busy &&
        !study.historical &&
        !(target instanceof HTMLElement && target.closest("button, a"))
      ) {
        event.preventDefault();
        void study.answer(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [study, question, feedback, busy]);
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
            <div className="practice-types">
              <span id="practice-types-label">Practise</span>
              <ToggleGroup
                type="multiple"
                value={study.selectedTypes}
                onValueChange={(types) =>
                  study.selectTypes(types as QuestionType[])
                }
                aria-labelledby="practice-types-label"
                disabled={busy}
              >
                {QUESTION_TYPES.map((type) => (
                  <ToggleGroupItem
                    key={type}
                    value={type}
                    className={`practice-type practice-type-${type}`}
                  >
                    {TYPE_LABELS[type]}s
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="muted">Select one or more</span>
            </div>
            {!demo && study.trial && (
              <div className="trial-banner" role="status">
                <strong>
                  {study.trialDaysRemaining}{" "}
                  {study.trialDaysRemaining === 1 ? "day" : "days"} left in your
                  free trial
                </strong>
                <span>
                  Full access ends{" "}
                  {new Date(study.trialEndsAt!).toLocaleDateString()}.
                </span>
                <Link href="/account">See membership →</Link>
              </div>
            )}
            <div className="session-bar">
              <span>
                {demo
                  ? `TRY ${study.freeWordCount ?? 20} FREE WORDS`
                  : study.freeTier
                    ? `FREE COLLECTION · ${study.freeWordCount ?? 20} WORDS`
                    : "YOUR PRACTICE"}
              </span>
              <span>
                {question ? TYPE_LABELS[question.type] : "Mixed practice"}
              </span>
            </div>
            <article
              className={`question-card question-${question?.type || "def"} ${feedback ? "question-answered" : ""}`}
              aria-busy={busy}
            >
              {question ? (
                <>
                  <div className="question-meta">
                    <span>
                      {study.historical
                        ? "PREVIOUS QUESTION · REVIEW ONLY"
                        : TYPE_LABELS[question.type].toUpperCase()}
                    </span>
                    <span className="pill">
                      {question.seen <= 1
                        ? "New word"
                        : `Seen ${question.seen} times`}
                    </span>
                  </div>
                  <h2>{question.word}</h2>
                  <p>{question.prompt}</p>
                  <div className="answers">
                    {question.choices.map((choice, i) => (
                      <button
                        key={`${question.id}-${i}`}
                        className={`answer ${feedback && choice === feedback.answer ? "correct" : ""} ${feedback && feedback.selected === i && !feedback.correct ? "incorrect" : ""}`}
                        disabled={busy || Boolean(feedback)}
                        aria-keyshortcuts={`${String.fromCharCode(65 + i)} ${i + 1}`}
                        onClick={() => void study.answer(i)}
                      >
                        <span>{String.fromCharCode(65 + i)}</span>
                        {choice}
                        {feedback && choice === feedback.answer && (
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
                            : "Not quite. Let’s learn this one."}
                      </strong>
                      {!!feedback.award?.total && (
                        <div className="reward-notice" key={question.id}>
                          <strong>
                            {feedback.award.streak
                              ? "Three in a row! +5 bonus"
                              : "Credits earned"}
                          </strong>
                          <p>
                            {[
                              feedback.award.base
                                ? `+${feedback.award.base} correct`
                                : null,
                              feedback.award.streak
                                ? `+${feedback.award.streak} streak`
                                : null,
                              feedback.award.mastery
                                ? `+${feedback.award.mastery} mastered`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}{" "}
                            = <b>+{feedback.award.total} credits</b>
                          </p>
                        </div>
                      )}
                      <WordExplanation word={feedback} />
                      {!demo && !feedback.correct && (
                        <small>
                          New streak starts with your next correct answer. Your
                          earned credits are safe.
                        </small>
                      )}
                      {!demo && !feedback.correct && (
                        <small>
                          This word is scheduled to return on your 15th next
                          question. It may return sooner if few words remain.
                        </small>
                      )}
                    </div>
                  )}
                  <div className="question-footer">
                    <span>
                      {Math.min(
                        MASTERY_TARGET,
                        question.correctCount + (feedback?.correct ? 1 : 0),
                      )}{" "}
                      of {MASTERY_TARGET} correct to master this word
                    </span>
                    {feedback ? (
                      <button
                        className="primary-button"
                        aria-keyshortcuts="Enter Space ArrowRight"
                        disabled={busy}
                        onClick={() => void study.next()}
                      >
                        {study.historical ? "Next question" : "Next word"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <button
                        className="text-button"
                        aria-keyshortcuts="Enter"
                        disabled={busy}
                        onClick={() => void study.answer(-1)}
                      >
                        Skip & reveal <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                  <p className="keyboard-hint">
                    {feedback
                      ? "← previous · →, Enter or Space next"
                      : "A–D or 1–4 to answer · Enter to reveal · ← previous"}
                  </p>
                </>
              ) : study.complete ? (
                <div className="empty-state">
                  <div className="eyebrow">
                    {demo ? "SAMPLE COMPLETE" : "CHALLENGE COMPLETE"}
                  </div>
                  <h2>
                    {study.gated
                      ? "Your free access has ended."
                      : demo
                        ? "Keep discovering."
                        : "Practice complete."}
                  </h2>
                  <p>
                    {study.gated
                      ? "Your saved progress is safe. Subscribe to keep practising the full word collection, reviewing your progress and exporting revision sheets."
                      : study.freeTier
                        ? `You have answered every word in your free ${study.freeWordCount ?? 20}-word collection correctly ${MASTERY_TARGET} times. Subscribe to unlock all ${stats.total} words.`
                        : demo
                          ? `Create a free account for ${study.trialDaysConfigured ?? 7} days of full access to every word and practice feature.`
                          : `Every available word in your selected practice types has been answered correctly ${MASTERY_TARGET} times. Select other types to keep practising.`}
                  </p>
                  {(demo || study.gated || study.freeTier) && (
                    <Link className="primary-button" href="/account">
                      {demo
                        ? "Create your free account →"
                        : "Upgrade to unlock all words →"}
                    </Link>
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
                  : study.trial
                    ? "Your free trial saves your progress"
                    : "Progress saved to your account"}
              </span>
            </div>
            {study.timeError && (
              <p className="error" role="status">
                {study.timeError} We’ll retry automatically.
              </p>
            )}
            <details className="previous-review">
              <summary>How questions are ordered</summary>
              {demo ? (
                <p>
                  The sample uses your configured, difficulty-balanced free
                  collection. Each shuffled round asks one question per word
                  before moving to its other selected types. Reloading or
                  changing types starts a fresh sample.
                </p>
              ) : (
                <>
                  <p>
                    We favour words you have seen least, choosing randomly when
                    tied. The last 20 different words are kept out of the next
                    selection; this gap shrinks when fewer words remain.
                  </p>
                  <p>
                    Missed or revealed words return on the 15th next question,
                    overriding the usual 20-word gap. With very few words left,
                    they may return sooner. Keep the same practice types
                    selected to include those reviews. For each word, we favour
                    its least-practised selected question type. Five correct
                    answers across types master the word and remove it from
                    practice.
                  </p>
                  <p>
                    Reloading resumes your unanswered question. Changing types
                    keeps your saved word progress.
                  </p>
                </>
              )}
            </details>
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
          <ProgressPanel
            stats={stats}
            demo={demo}
            liveSeconds={study.liveSeconds}
          />
        </div>
        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>11+ VOCABULARY CHALLENGE</span>
        </footer>
      </main>
    </div>
  );
}
