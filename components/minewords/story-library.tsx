"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";
import { DIFFICULTY_LEVELS, type Difficulty } from "@/lib/challenge/difficulty";
import type { StoryCard } from "@/lib/challenge/stories";
import DailyMission from "./daily-mission";
import {
  readBookmarks,
  saveReadingLevel,
  type Bookmark,
} from "@/lib/client/reading-bookmarks";
export type Catalog = {
  signedIn: boolean;
  bookmarkScope: string;
  credits: number;
  preference: { level: number; revision: number };
  stories: StoryCard[];
};

export default function StoryLibrary() {
  const [data, setData] = useState<Catalog | null>(null);
  const [level, setLevel] = useState<Difficulty>(0);
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>({});
  const [error, setError] = useState("");
  const changingLevel = useRef(false);
  const [levelBusy, setLevelBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const refresh = () => {
      if (changingLevel.current) return;
      const request = ++sequence;
      void api<Catalog>("/api/stories")
        .then((result) => {
          if (active && request === sequence && !changingLevel.current) {
            setData(result);
            const saved = readBookmarks(result.bookmarkScope);
            setLevel(
              (result.signedIn
                ? result.preference.level
                : saved.level) as Difficulty,
            );
            setBookmarks(
              result.signedIn
                ? Object.fromEntries(
                    result.stories
                      .filter((story) => story.bookmark)
                      .map((story) => [story.id, story.bookmark!]),
                  )
                : saved.stories,
            );
            setError("");
          }
        })
        .catch((e: Error) => {
          if (active && request === sequence) setError(e.message);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [retry]);
  async function selectLevel(next: Difficulty) {
    if (changingLevel.current) return;
    if (!data?.signedIn) {
      setLevel(next);
      if (data) saveReadingLevel(data.bookmarkScope, next);
      return;
    }
    changingLevel.current = true;
    setLevelBusy(true);
    try {
      const preference = await api<Catalog["preference"]>("/api/stories", {
        action: "level",
        level: next,
        revision: data.preference.revision,
      });
      setData((current) => (current ? { ...current, preference } : current));
      setLevel(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      changingLevel.current = false;
      setLevelBusy(false);
    }
  }
  const continuing = data?.stories
    .filter((story) => !story.completed && bookmarks[story.id])
    .sort((a, b) => bookmarks[b.id].updatedAt - bookmarks[a.id].updatedAt)[0];
  const stories = data?.stories.filter((story) => story.level === level) || [];
  return (
    <>
      <Header />
      <main className="workspace stories-workspace">
        <section className="stories-hero">
          <div>
            <div className="eyebrow">BIG LAUGHS. BRILLIANT WORDS.</div>
            <h1>Word Adventures</h1>
            <p>
              Runaway inventions, peculiar pets and plans that go wonderfully
              wrong. Meet your vocabulary words inside a story worth finishing.
            </p>
            <p className="stories-help">
              Choose a level. Hover over, tap or focus on a{" "}
              <strong>bold word</strong> for its meaning, synonyms and antonyms.
            </p>
          </div>
          <div className="stories-reward">
            <Sparkles size={30} />
            <strong>Read. Smile. Earn.</strong>
            <span>
              Finish a story and its quick question to earn{" "}
              {data?.credits ?? 10} credits, once per story.
            </span>
            {data?.signedIn ? (
              <Link href="/rewards">See your rewards →</Link>
            ) : (
              <Link href="/account">Sign in to save your adventures →</Link>
            )}
          </div>
        </section>
        {data && <DailyMission signedIn={data.signedIn} />}
        {continuing && (
          <aside className="continue-reading">
            <div>
              <strong>Ready for the next bit?</strong>
              <p>{continuing.title}</p>
              <small>
                {data?.signedIn
                  ? "Your place follows you across devices."
                  : "Your place is saved on this browser."}
              </small>
            </div>
            <Link
              className="primary-button"
              href={`/stories/${continuing.id}?resume=1`}
            >
              Continue reading →
            </Link>
          </aside>
        )}
        <div
          className="story-levels"
          role="group"
          aria-label="Story difficulty"
        >
          {Object.entries(DIFFICULTY_LEVELS).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={level === Number(key)}
              disabled={levelBusy || !data}
              onClick={() => void selectLevel(Number(key) as Difficulty)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="story-shelf-heading">
          <h2>{DIFFICULTY_LEVELS[level]}</h2>
          {data && (
            <span>
              {stories.filter((story) => story.completed).length} of{" "}
              {stories.length} adventures completed
            </span>
          )}
        </div>
        {data &&
          stories.length > 0 &&
          stories.every((story) => story.completed) && (
            <p className="reward-notice">
              Level complete! Choose another level, or reread a favourite for
              today’s mission.
            </p>
          )}
        <p className="muted">
          Ten stories explore every word in this level. Pick any adventure;
          levels describe the vocabulary, not your age.
        </p>
        <p className="story-unread-legend">
          <span className="story-unread-dot" aria-hidden="true" /> Unread · the
          blue dot clears when you complete the story.
        </p>
        {!data && !error && <p role="status">Opening the story cupboard…</p>}
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
        <div className="story-grid">
          {stories.map((story) => (
            <Link
              href={`/stories/${story.id}${!story.completed && (bookmarks[story.id] || story.started) ? "?resume=1" : ""}`}
              className="story-card"
              key={story.id}
            >
              <div className="story-card-top">
                <span>ADVENTURE {String(story.number).padStart(2, "0")}</span>
                {story.completed ? (
                  <span className="story-completed">
                    <CheckCircle2 size={17} /> Read
                  </span>
                ) : (
                  <>
                    {(bookmarks[story.id] || story.started) && (
                      <span className="story-started">Started</span>
                    )}
                    <span
                      className="story-unread-dot"
                      role="img"
                      aria-label="Unread story"
                      title="Unread story"
                    />
                  </>
                )}
              </div>
              <h3>{story.title}</h3>
              <p>{story.summary}</p>
              <div className="story-card-footer">
                <span>
                  {story.wordCount} words to discover · about {story.minutes}{" "}
                  min
                </span>
                <strong>
                  {story.completed
                    ? "Read again"
                    : bookmarks[story.id] || story.started
                      ? "Continue reading"
                      : "Let’s read"}{" "}
                  →
                </strong>
              </div>
            </Link>
          ))}
        </div>
        <p className="stories-footer">
          Read at your own pace. A grown-up can join in, and you can come back
          to finish another day.
        </p>
      </main>
    </>
  );
}
