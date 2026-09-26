"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";
import { DIFFICULTY_LEVELS } from "@/lib/challenge/difficulty";
import {
  STORY_CREDITS,
  type StoryDetail,
  type ReadingProgress,
} from "@/lib/challenge/stories";
import WordHint from "./word-hint";
import type { Catalog } from "./story-library";
import { useReadingClock } from "./use-reading-clock";
import DailyMission from "./daily-mission";
import { useReadingBookmark } from "./use-reading-bookmark";

function Reading({ story }: { story: StoryDetail }) {
  const [progress, setProgress] = useState(story.progress);
  const [answer, setAnswer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const clock = useReadingClock(story.id, story.signedIn, setProgress);
  const prose = useRef<HTMLElement>(null);
  const bookmark = useReadingBookmark(story, prose);
  const [finishedVisit, setFinishedVisit] = useState(false);
  const savedLevel = useRef(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let alive = true;
    void api<Catalog>("/api/stories")
      .then((value) => {
        if (alive) setCatalog(value);
        if (alive && story.signedIn && !savedLevel.current) {
          savedLevel.current = true;
          if (value.preference.level !== story.level)
            void api("/api/stories", {
              action: "level",
              level: story.level,
              revision: value.preference.revision,
            }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [finishedVisit, story.signedIn, story.level]);
  const nextStory = catalog?.stories
    .filter(
      (item) =>
        item.level === story.level && item.id !== story.id && !item.completed,
    )
    .sort(
      (a, b) =>
        ((a.number - story.number + 10) % 10) -
        ((b.number - story.number + 10) % 10),
    )[0];
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
      setFinishedVisit(true);
      setNotice(
        result.credits
          ? `Adventure complete! You earned ${result.credits} credits.`
          : "Adventure complete! Your reread counts towards today’s mission. You’ve already earned this story’s credits.",
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

        <p className="stories-help">
          {story.wordIds.length} words to discover. Tap a{" "}
          <strong>bold word</strong> for help.
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
          <Link href="/account">Sign in</Link> to save your progress and earn
          credits.
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
      <div className="reading-tools">
        <details>
          <summary>Reading help</summary>
          <p>
            Tap, hover over or focus a bold word for its meaning. You can hear
            it spoken too. Read at your own pace, then answer the question at
            the end.
          </p>
        </details>
        <button className="text-button" onClick={bookmark.startAgain}>
          Start again
        </button>
      </div>
      {bookmark.status && (
        <small className="bookmark-status" role="status">
          {bookmark.status}
        </small>
      )}
      <article ref={prose} className="story-prose" aria-label={story.title}>
        {story.paragraphs.map((paragraph, p) => (
          <p key={p} data-reading-paragraph={p}>
            {paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
              if (!part.startsWith("**")) return part;
              const text = part.slice(2, -2),
                word = vocabulary.get(text.toLowerCase());
              return word ? (
                <WordHint
                  key={`${p}-${i}`}
                  text={text}
                  word={word}
                  storyId={story.id}
                />
              ) : (
                text
              );
            })}
          </p>
        ))}
      </article>
      <DailyMission
        signedIn={story.signedIn}
        refreshKey={finishedVisit ? "finished" : "reading"}
      />
      <section className="story-finish" aria-labelledby="story-question-title">
        <div className="eyebrow">ONE LAST LITTLE ADVENTURE</div>
        <h2 id="story-question-title">{story.question.prompt}</h2>
        <p>
          Read at your own pace, then answer to finish. Your first completion
          earns {STORY_CREDITS} credits.
        </p>
        <fieldset disabled={busy || finishedVisit}>
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
            disabled={busy || answer === null || finishedVisit}
            onClick={() => void finish()}
          >
            {finishedVisit
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
            Reading time saves while you’re active. A reread counts towards your
            daily mission, but each story awards credits once.
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
        {nextStory ? (
          <Link
            className="primary-button next-adventure"
            href={`/stories/${nextStory.id}${nextStory.started ? "?resume=1" : ""}`}
          >
            Next unread adventure: {nextStory.title} →
          </Link>
        ) : catalog && (progress.completedAt || finishedVisit) ? (
          <p className="reward-notice">
            Level complete! Choose another level or revisit a favourite.
          </p>
        ) : null}
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
