"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Lightbulb } from "lucide-react";
import Pronunciation from "./pronunciation";
import AnswerPacing from "./answer-pacing";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  QUESTION_TYPES,
  TYPE_BUTTONS,
  TYPE_INSTRUCTIONS,
  TYPE_LABELS,
  TYPE_SUMMARIES,
  typeAsksForTheWord,
  type QuestionType,
} from "@/lib/challenge/config";
import {
  CUMULATIVE_FLOOR,
  describeRecallTargets,
  runTarget,
} from "@/lib/challenge/mastery";
import { DIFFICULTY_LEVELS, type Difficulty } from "@/lib/challenge/difficulty";
import Header from "./header";
import ProgressPanel from "./progress-panel";
import DailyMission from "./daily-mission";
import WordExplanation from "./word-explanation";
import { CoachNote } from "./coach-note";
import {
  NEXT_DELAYS,
  NEXT_DELAY_LABELS,
  pauseAutoNext,
  type NextDelay,
} from "@/lib/client/auto-next";

import { usePlaySound } from "@/lib/theme/sound-provider";
import { useAnswerSound } from "@/lib/theme/use-sounds";
import { useChallenge } from "./use-challenge";
const levelLabel = (difficulty: number) =>
  difficulty in DIFFICULTY_LEVELS
    ? DIFFICULTY_LEVELS[difficulty as Difficulty]
    : "";
export default function Challenge() {
  const study = useChallenge();
  const [clueQuestion, setClueQuestion] = useState<string | null>(null);
  const { question, feedback, stats, demo, busy, error } = study;
  const mastery = feedback?.mastery ?? question?.mastery;
  // The run the child just extended, which is the one the coach names. Before
  // an answer there is nothing to say about a run that has not happened.
  const streak = feedback?.award?.currentStreak ?? 0;
  const questionLevel =
    question?.difficulty !== undefined ? levelLabel(question.difficulty) : "";
  // The answer sound depends on more than right and wrong: revealing is not a
  // failure, and mastering a word is a bigger moment than getting one right.
  // The clue gets its own sound, which rises and then falls back so it can
  // never be mistaken for the reward for a right answer.
  const playSound = usePlaySound();
  useAnswerSound(
    feedback
      ? {
          correct: feedback.correct,
          skipped: feedback.skipped,
          // currentStreak is the run of right answers. award.streak is the
          // number of bonus credits that run earned, which is 5 or 0 and so
          // was making every right answer look identical to the one before it.
          streak: feedback.award?.currentStreak,
          mastered: feedback.newlyMastered,
          attemptId: feedback.attemptId,
        }
      : null,
  );
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
  // A word or cloze question asks the child to produce the word, so the card
  // must not print it or play it above the options.
  const asksForWord = question ? typeAsksForTheWord(question.type) : false;
  return (
    <div className="site">
      <Header />
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">A FEW WORDS A DAY</div>
            <h1>11+ Vocabulary Challenge</h1>
            <p>Build your vocabulary, one word at a time.</p>
          </div>
          <span className="edition">
            <BookOpen size={16} /> Vocabulary practice
          </span>
        </div>
        <DailyMission stats={demo ? undefined : stats} signedIn={!demo} />
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
                    <span>{TYPE_BUTTONS[type]}</span>
                    <small>{TYPE_SUMMARIES[type]}</small>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="muted">Select one or more</span>
            </div>
            <div className="practice-level">
              <label htmlFor="practice-level">Practise level</label>
              <select
                id="practice-level"
                value={study.level ?? "all"}
                disabled={busy}
                onChange={(event) =>
                  study.selectLevel(
                    event.target.value === "all"
                      ? null
                      : (Number(event.target.value) as Difficulty),
                  )
                }
              >
                <option value="all">All levels</option>
                {Object.entries(DIFFICULTY_LEVELS).map(([number, label]) => (
                  <option key={number} value={number}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="muted">
                Optional. Every level is part of the same saved progress.
              </span>
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
              className={`question-card question-${question?.type || "def"} ${feedback ? "question-answered" : ""} ${question ? "question-entering" : ""}`}
              // Keyed on the question, so the entrance plays once per question
              // rather than on every re-render of the same one.
              key={question?.id || "empty"}
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
                    <span className="question-badges">
                      {questionLevel && (
                        <span className="pill level-pill">{questionLevel}</span>
                      )}
                      <span className="pill">
                        {question.seen <= 1
                          ? "New word"
                          : `Seen ${question.seen} times`}
                      </span>
                    </span>
                  </div>
                  {/* A word or cloze question asks the child to produce the word,
                      so the card must not print it or play it above the options:
                      the answer would already be on screen. The server blanks the
                      word out of the cloze sentence for the same reason. */}
                  {!asksForWord && (
                    <div className="question-word">
                      <h2>{question.word}</h2>
                      <Pronunciation
                        key={question.id}
                        word={question.word}
                        id={question.wordId}
                      />
                    </div>
                  )}
                  {/* Two of the five question types carry no question of their
                      own: a word question shows a bare definition and a cloze
                      shows a sentence with a gap. The instructions say which is
                      which, so the child is not left guessing. */}
                  {!feedback ? (
                    <p className="question-instruction">
                      {TYPE_INSTRUCTIONS[question.type]}
                    </p>
                  ) : null}
                  <p>{question.prompt}</p>
                  {!feedback && question.clue && (
                    <div className="question-clue">
                      {clueQuestion === question.id ? (
                        <p role="status">
                          <strong>A clue:</strong> {question.clue}
                        </p>
                      ) : (
                        <button
                          className="clue-button"
                          disabled={busy}
                          onClick={() => {
                            study.markAssisted();
                            setClueQuestion(question.id);
                            playSound("hint");
                          }}
                        >
                          <Lightbulb size={15} aria-hidden /> Give me a clue
                        </button>
                      )}
                    </div>
                  )}
                  <div className={`answers${!feedback ? " answers-entering" : ""}`}>
                    {question.choices.map((choice, i) => (
                      <button
                        key={`${question.id}-${i}`}
                        className={`answer ${feedback && choice === feedback.answer ? "correct" : ""} ${feedback && feedback.selected === i && !feedback.correct ? "incorrect" : ""}`}
                        aria-disabled={busy || Boolean(feedback)}
                        aria-keyshortcuts={`${String.fromCharCode(65 + i)} ${i + 1}`}
                        onClick={() => {
                          if (busy || feedback) return;
                          void study.answer(i);
                        }}
                      >
                        <span>{String.fromCharCode(65 + i)}</span>
                        {choice}
                        {feedback && choice === feedback.answer && (
                          <span aria-label="The correct answer">✓</span>
                        )}
                        {feedback &&
                          !feedback.correct &&
                          feedback.selected === i && (
                            <span aria-label="Your answer">✗</span>
                          )}
                      </button>
                    ))}
                  </div>
                  <p className="sr-only" role="status">
                    {asksForWord ? "" : `${question.word}. `}
                    {TYPE_INSTRUCTIONS[question.type]}{" "}
                    {question.prompt}
                  </p>
                  {feedback && (
                    <div className="feedback" role="status">
                      {/* What the app says, built from this child's own record on
                          this word rather than from a fixed list of praise. */}
                      <CoachNote
                        feedback={feedback}
                        streak={streak}
                        word={question.word}
                        seen={question.seen}
                        correctCount={question.correctCount}
                        difficulty={question.difficulty}
                      />
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
                      {feedback.chosen ? (
                        <div className="chosen-explanation">
                          <strong>
                            {feedback.chosen.word} means {feedback.chosen.meaning}
                          </strong>
                          {feedback.chosen.example ? (
                            <em>{feedback.chosen.example}</em>
                          ) : null}
                        </div>
                      ) : null}
                      {!demo && !feedback.correct && (
                        <small>
                          Your run of right answers starts again with your next
                          one. The credits you have already earned are safe.
                        </small>
                      )}
                      {!demo && !feedback.correct && (
                        <small>
                          This word will come back later, so it has a chance to
                          stick.
                        </small>
                      )}
                    </div>
                  )}
                  <div className="question-footer">
                    <div className="mastery-mini">
                      <span>
                        {mastery?.mastered
                          ? "Word mastered!"
                          : `${mastery?.correct ?? question.correctCount} of ${CUMULATIVE_FLOOR} right${
                              (mastery?.recalls ?? 0) > 0
                                ? ` · got it ${mastery?.recalls}/${mastery?.target ?? 2} times on your own`
                                : ""
                            }`}
                      </span>
                      <span
                        className="mastery-circles"
                        role="img"
                        aria-label={
                          mastery?.mastered
                            ? "Mastered"
                            : `${mastery?.correct ?? question.correctCount} of ${CUMULATIVE_FLOOR} right answers; getting it right ${mastery?.target ?? 2} times on your own also finishes a word`
                        }
                      >
                        {Array.from({ length: CUMULATIVE_FLOOR }, (_, index) => (
                          <i
                            key={index}
                            className={
                              index <
                              (mastery?.mastered
                                ? CUMULATIVE_FLOOR
                                : mastery?.correct ?? question.correctCount)
                                ? "filled"
                                : ""
                            }
                          />
                        ))}
                      </span>
                    </div>
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
                  {feedback && (
                    <AnswerPacing
                      key={`${question.id}:${study.autoNext}`}
                      id={question.id}
                      delay={study.autoNext}
                      // The daily target does not switch this off. It used to,
                      // so a setting the child had chosen stopped working the
                      // moment the day's count was reached, with nothing said.
                      eligible={Boolean(
                        feedback.correct && !busy && !error && !study.historical,
                      )}
                      next={study.next}
                    />
                  )}
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
                        ? `You have mastered every word in your free collection of ${stats.total}. Subscribe to practise all ${stats.collection}.`
                        : demo
                          ? `Create a free account for ${study.trialDaysConfigured ?? 7} days of full access to every word and practice feature.`
                          : study.level !== null
                            ? `Every Level ${study.level} word in your selected practice types has been mastered. Choose another level, or select other types, to keep practising.`
                            : `Every available word in your selected practice types has been mastered. Select other types to keep practising.`}
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
              <label className="next-word-setting">
                Next word
                <select
                  aria-label="How quickly the next word appears"
                  value={study.autoNext}
                  onChange={(e) =>
                    study.setAutoNext(Number(e.target.value) as NextDelay)
                  }
                >
                  {NEXT_DELAYS.map((delay) => (
                    <option key={delay} value={delay}>
                      {NEXT_DELAY_LABELS[delay]}
                    </option>
                  ))}
                </select>
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
            <details
              className="previous-review"
              onToggle={(e) => {
                if (e.currentTarget.open) pauseAutoNext();
              }}
            >
              <summary>How questions are ordered</summary>
              {demo ? (
                <p>
                  The sample uses your configured, difficulty-balanced free
                  collection. Each shuffled round asks one question per word
                  before moving to its other selected types. Choosing a level
                  narrows the sample to the free words in that level. Reloading
                  or changing types starts a fresh sample.
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
                    its least-practised selected question type.
                  </p>
                  <p>
                    <strong>How a word becomes mastered.</strong> Answering
                    unhurried and without a clue counts as a sure recall:{" "}
                    {describeRecallTargets()}. Right answers in a row also do it
                    — {runTarget(0)} for Level 0 and {runTarget(5)} for the
                    hardest words — and so do {CUMULATIVE_FLOOR} right answers
                    whenever they come. A clue, a mistake or a reveal starts the
                    count again. Take your time: speed is a bonus, never a
                    requirement.
                  </p>
                  <p>
                    Reloading resumes your unanswered question. Changing types
                    or level keeps your saved word progress.
                  </p>
                </>
              )}
            </details>
            {study.previous && (
              <details
                className="previous-review"
                onToggle={(e) => {
                  if (e.currentTarget.open) pauseAutoNext();
                }}
              >
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
