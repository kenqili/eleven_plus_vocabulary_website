"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";
import { DIFFICULTY_LEVELS } from "@/lib/challenge/difficulty";
import {
  STORY_CREDITS,
  type StoryDetail,
  type ReadingProgress,
} from "@/lib/challenge/stories";
import type { Word } from "@/lib/challenge/words";
import { useReadingClock } from "./use-reading-clock";

function WordHint({ text, word }: { text: string; word: Word }) {
  const id = useId(),
    button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function show() {
    clearTimeout(timer.current);
    const rect = button.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 230),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)),
      });
  }
  function hide() {
    timer.current = setTimeout(() => setPosition(null), 120);
  }
  useEffect(() => {
    const dismiss = () => setPosition(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <span className="story-word-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={button}
        type="button"
        className="story-word"
        aria-describedby={position ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        <strong>{text}</strong>
      </button>
      {position && (
        <span
          className="story-word-note"
          id={id}
          role="tooltip"
          style={position}
          onMouseEnter={() => clearTimeout(timer.current)}
          onMouseLeave={hide}
        >
          <strong>{word.word}</strong>
          <span>{word.definition}</span>
          <span>
            <b>Synonyms (similar):</b>{" "}
            {word.syn && word.syn !== "—"
              ? word.syn
              : "No close synonym listed"}
          </span>
          <span>
            <b>Antonyms (opposite):</b>{" "}
            {word.ant && word.ant !== "—"
              ? word.ant
              : "No direct opposite listed"}
          </span>
        </span>
      )}
    </span>
  );
}
function Reading({ story }: { story: StoryDetail }) {
  const [progress, setProgress] = useState(story.progress);
  const [answer, setAnswer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const clock = useReadingClock(story.id, story.signedIn, setProgress);
  const vocabulary = new Map(story.vocabulary.map((word) => [word.id, word]));
  async function finish() {
    if (busy || answer === null) return;
    setBusy(true);
    setError("");
    try {
      await clock.flush();
      const result = await api<{ progress: ReadingProgress; credits: number }>(
        "/api/stories",
        { action: "complete", storyId: story.id, answer },
      );
      setProgress(result.progress);
      setNotice(
        result.credits
          ? `Adventure complete! You earned ${result.credits} credits.`
          : "You’ve already earned this adventure’s credits. Enjoy reading it again!",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="story-title">
        <div className="eyebrow">
          {DIFFICULTY_LEVELS[story.level]} · ADVENTURE {story.number}
        </div>
        <h1>{story.title}</h1>
        <p>{story.summary}</p>
        <p className="stories-help">
          {story.wordIds.length} words to discover. Hover, tap or use Tab to
          explore the <strong>bold words</strong>.
        </p>
        {progress.completedAt && (
          <span className="story-completed">
            <CheckCircle2 size={18} /> Adventure completed · reread whenever you
            like
          </span>
        )}
      </header>
      {!story.signedIn && (
        <p className="story-signin">
          Enjoy the story! <Link href="/account">Sign in</Link> to save reading
          time and earn credits.
        </p>
      )}
      <div className="story-reading-timer">
        <Clock3 size={20} aria-hidden="true" />
        <div>
          <span>Reading time · this visit</span>
          <strong
            role="timer"
            aria-label="Reading time this visit"
            aria-live="off"
          >
            {Math.floor(clock.sessionSeconds / 60)
              .toString()
              .padStart(2, "0")}
            :{(clock.sessionSeconds % 60).toString().padStart(2, "0")}
          </strong>
        </div>
        <span className="story-timer-state">
          {clock.isRunning ? "Reading" : "Paused"}
        </span>
      </div>
      <article className="story-prose" aria-label={story.title}>
        {story.paragraphs.map((paragraph, p) => (
          <p key={p}>
            {paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
              if (!part.startsWith("**")) return part;
              const text = part.slice(2, -2),
                word = vocabulary.get(text.toLowerCase());
              return word ? (
                <WordHint key={`${p}-${i}`} text={text} word={word} />
              ) : (
                text
              );
            })}
          </p>
        ))}
      </article>
      <section className="story-finish" aria-labelledby="story-question-title">
        <div className="eyebrow">ONE LAST LITTLE ADVENTURE</div>
        <h2 id="story-question-title">{story.question.prompt}</h2>
        <p>
          Read at your own pace, then answer to finish. Your first completion
          earns {STORY_CREDITS} credits.
        </p>
        <fieldset disabled={busy || Boolean(progress.completedAt)}>
          <legend>Choose your answer</legend>
          {story.question.options.map((option, index) => (
            <label key={option}>
              <input
                type="radio"
                name="story-answer"
                checked={answer === index}
                onChange={() => setAnswer(index)}
              />
              {option}
            </label>
          ))}
        </fieldset>
        {story.signedIn ? (
          <button
            className="primary-button"
            disabled={busy || answer === null || Boolean(progress.completedAt)}
            onClick={() => void finish()}
          >
            {progress.completedAt
              ? "Adventure completed ✓"
              : busy
                ? "Saving your adventure…"
                : "Finish my adventure"}
          </button>
        ) : (
          <Link className="primary-button" href="/account">
            Sign in to earn reading credits
          </Link>
        )}
        {story.signedIn && (
          <p className="muted">
            Reading time saves while you’re active on this page. Rereading adds
            time, but each story awards credits once.
          </p>
        )}
        {(error || clock.error) && (
          <p className="error" role="alert">
            {error || clock.error}
          </p>
        )}
        {notice && (
          <p className="reward-notice" role="status">
            {notice} <Link href="/rewards">See your badges →</Link>
          </p>
        )}
        <div className="control-row">
          <Link className="text-button" href="/stories">
            Choose another adventure →
          </Link>
          <Link className="text-button" href="/calendar">
            Your learning calendar →
          </Link>
        </div>
      </section>
    </>
  );
}
export default function StoryReader({ id }: { id: string }) {
  const [story, setStory] = useState<StoryDetail | null>(null),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api<StoryDetail>(`/api/stories?id=${encodeURIComponent(id)}`)
      .then((data) => {
        if (active) {
          setStory(data);
          setError("");
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  return (
    <>
      <Header />
      <main className="workspace story-reader">
        <Link className="text-button" href="/stories">
          ← All Word Adventures
        </Link>
        {story?.id === id && <Reading key={id} story={story} />}
        {!story && !error && <p role="status">Opening your adventure…</p>}
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button
              className="text-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Try again
            </button>
          </p>
        )}
      </main>
    </>
  );
}
