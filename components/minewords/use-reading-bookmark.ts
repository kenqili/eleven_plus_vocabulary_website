"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/client/api";
import {
  readBookmarks,
  saveBookmark,
  saveReadingLevel,
} from "@/lib/client/reading-bookmarks";
import type { StoryDetail } from "@/lib/challenge/stories";
import type { ReadingBookmark } from "@/lib/server/reading-position";
export function useReadingBookmark(
  story: StoryDetail,
  prose: RefObject<HTMLElement | null>,
) {
  const [status, setStatus] = useState("");
  const startAgain = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true,
      ready = false,
      dirty = false,
      conflict = false;
    let revision = story.bookmark?.revision ?? 0;
    const stored = story.signedIn
      ? story.bookmark
      : readBookmarks(story.bookmarkScope).stories[story.id];
    let latest = {
      paragraph: stored?.paragraph ?? 0,
      fraction: stored?.fraction ?? 0,
      updatedAt: Date.now(),
    };
    let pending: Promise<void> | null = null;
    saveReadingLevel(story.bookmarkScope, story.level);
    const nodes = () =>
      Array.from(
        prose.current?.querySelectorAll<HTMLElement>(
          "[data-reading-paragraph]",
        ) ?? [],
      );
    const flush = () => {
      if (!dirty || pending || conflict) return;
      saveBookmark(story.bookmarkScope, story.id, latest);
      if (!story.signedIn) {
        dirty = false;
        return;
      }
      const sent = { ...latest };
      dirty = false;
      let failed = false;
      pending = api<ReadingBookmark>(
        "/api/stories",
        {
          action: "bookmark",
          storyId: story.id,
          paragraph: sent.paragraph,
          fraction: sent.fraction,
          revision,
        },
        { keepalive: true },
      )
        .then((result) => {
          revision = result.revision;
          if (alive) setStatus("Reading place saved");
        })
        .catch((e: Error) => {
          failed = true;
          dirty = true;
          conflict = e.message.includes("another tab or device");
          if (alive)
            setStatus(
              conflict
                ? e.message
                : "Reading place waiting to sync. Keep this page open until it saves.",
            );
        })
        .finally(() => {
          pending = null;
          if (!alive && dirty && !conflict && !failed) flush();
        });
    };
    const capture = () => {
      if (!ready) return;
      const paragraphs = nodes();
      let paragraph = 0;
      for (let i = 0; i < paragraphs.length; i++)
        if (paragraphs[i].getBoundingClientRect().top <= 101) paragraph = i;
      const rect = paragraphs[paragraph]?.getBoundingClientRect();
      const fraction = rect
        ? Math.max(0, Math.min(1, (100 - rect.top) / rect.height))
        : 0;
      if (
        paragraph !== latest.paragraph ||
        Math.abs(fraction - latest.fraction) > 0.005
      ) {
        latest = { paragraph, fraction, updatedAt: Date.now() };
        dirty = true;
        saveBookmark(story.bookmarkScope, story.id, latest);
      }
    };
    const restore = setTimeout(() => {
      if (
        stored &&
        new URLSearchParams(location.search).get("resume") === "1"
      ) {
        const paragraphs = nodes();
        const rect =
          paragraphs[
            Math.min(stored.paragraph, paragraphs.length - 1)
          ]?.getBoundingClientRect();
        if (rect)
          window.scrollTo({
            top: scrollY + rect.top + rect.height * stored.fraction - 100,
            behavior: "instant",
          });
      } else latest = { paragraph: 0, fraction: 0, updatedAt: Date.now() };
      ready = true;
      dirty = true;
      flush();
    }, 200);
    startAgain.current = () => {
      const rect = nodes()[0]?.getBoundingClientRect();
      latest = { paragraph: 0, fraction: 0, updatedAt: Date.now() };
      dirty = true;
      if (rect)
        window.scrollTo({ top: scrollY + rect.top - 100, behavior: "instant" });
      flush();
    };
    const leave = () => {
      capture();
      flush();
    };
    const visibility = () => {
      if (document.hidden) leave();
    };
    const interval = setInterval(flush, 5000);
    window.addEventListener("scroll", capture, { passive: true });
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      clearTimeout(restore);
      clearInterval(interval);
      window.removeEventListener("scroll", capture);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", visibility);
      flush();
    };
  }, [
    story.id,
    story.level,
    story.bookmarkScope,
    story.bookmark,
    story.signedIn,
    prose,
  ]);
  return { status, startAgain: () => startAgain.current() };
}
