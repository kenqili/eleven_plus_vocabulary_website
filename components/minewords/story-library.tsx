"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";
import { DIFFICULTY_LEVELS, type Difficulty } from "@/lib/challenge/difficulty";
import type { StoryCard } from "@/lib/challenge/stories";
type Catalog = { signedIn: boolean; credits: number; stories: StoryCard[] };

export default function StoryLibrary() {
  const [data, setData] = useState<Catalog | null>(null);
  const [level, setLevel] = useState<Difficulty>(1);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      void api<Catalog>("/api/stories")
        .then((result) => {
          if (active && request === sequence) {
            setData(result);
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
        <div
          className="story-levels"
          role="group"
          aria-label="Story difficulty"
        >
          {Object.entries(DIFFICULTY_LEVELS).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={level === Number(key)}
              onClick={() => setLevel(Number(key) as Difficulty)}
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
              href={`/stories/${story.id}`}
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
                  <span
                    className="story-unread-dot"
                    role="img"
                    aria-label="Unread story"
                    title="Unread story"
                  />
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
                  {story.completed ? "Read again" : "Let’s read"} →
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
