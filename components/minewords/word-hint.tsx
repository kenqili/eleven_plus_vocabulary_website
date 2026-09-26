"use client";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Word } from "@/lib/challenge/words";
import { storyMeaning, storyRelated } from "@/lib/challenge/story-meanings";
import { pauseAutoNext } from "@/lib/client/auto-next";
import Pronunciation from "./pronunciation";
export default function WordHint({
  text,
  word,
  storyId,
}: {
  text: string;
  word: Word;
  storyId: string;
}) {
  const id = useId();
  const related = storyRelated(word, storyId);
  const button = useRef<HTMLButtonElement>(null),
    note = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipFocus = useRef(false);
  const close = (restore = false) => {
    clearTimeout(timer.current);
    setPosition(null);
    if (restore) {
      skipFocus.current = true;
      button.current?.focus();
      skipFocus.current = false;
    }
  };
  function show() {
    if (skipFocus.current) return;
    clearTimeout(timer.current);
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      pauseAutoNext();
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(12, Math.min(rect.left, innerWidth - 332)),
      });
    }
  }
  function hide() {
    timer.current = setTimeout(() => {
      if (
        !note.current?.contains(document.activeElement) &&
        document.activeElement !== button.current
      )
        setPosition(null);
    }, 180);
  }
  useLayoutEffect(() => {
    if (!position || !note.current) return;
    const clamp = () => {
      const rect = note.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition((current) => {
        if (!current) return current;
        const top = Math.max(
          12,
          Math.min(current.top, innerHeight - rect.height - 12),
        );
        return top === current.top ? current : { ...current, top };
      });
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(note.current);
    return () => observer.disconnect();
  }, [position]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        close(Boolean(note.current?.contains(document.activeElement)));
    };
    const outside = (e: PointerEvent) => {
      if (
        !note.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        close();
    };
    const reposition = () =>
      close(Boolean(note.current?.contains(document.activeElement)));
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  }, []);
  return (
    <span className="story-word-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={button}
        type="button"
        className="story-word"
        aria-haspopup="dialog"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          show();
          setTimeout(() => note.current?.focus(), 0);
        }}
      >
        <strong>{text}</strong>
      </button>
      {position &&
        createPortal(
          <div
            ref={note}
            tabIndex={-1}
            id={id}
            role="dialog"
            aria-label={`Help with ${word.word}`}
            className="story-word-note"
            style={position}
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={hide}
            onBlur={hide}
          >
            <div className="word-note-heading">
              <strong>{word.word}</strong>
              <button
                type="button"
                aria-label="Close word help"
                onClick={() => close(true)}
              >
                ×
              </button>
            </div>
            <span>{storyMeaning(word, storyId)}</span>
            <Pronunciation word={word.word} id={word.id} />
            <span>
              <b>Similar words (synonyms):</b>{" "}
              {related.syn && related.syn !== "—"
                ? related.syn
                : "No close synonym listed"}
            </span>
            <span>
              <b>Opposite words (antonyms):</b>{" "}
              {related.ant && related.ant !== "—"
                ? related.ant
                : "No direct opposite listed"}
            </span>
            <details
              onToggle={(e) => {
                if (e.currentTarget.open) pauseAutoNext();
              }}
            >
              <summary>More word help</summary>
              <p>{word.definition}</p>
              <p>Example: {word.example}</p>
            </details>
          </div>,
          document.body,
        )}
    </span>
  );
}
