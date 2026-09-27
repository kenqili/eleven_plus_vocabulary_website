"use client";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Word } from "@/lib/challenge/words";
// Only the small per-story context file is imported here. The 434KB
// plain-language help file is loaded on the server and arrives with the story.
import { storyRelated } from "@/lib/challenge/story-meanings";
import { pauseAutoNext } from "@/lib/client/auto-next";
import Pronunciation from "./pronunciation";

/** A dash or blank in the CSVs means no relation was supplied for that word. */
const has = (value: string) => !!value?.trim() && !/^[—–-]$/.test(value.trim());

export default function WordHint({
  text,
  word,
  storyId,
}: {
  text: string;
  /** A story target word, with the server's plain-language help attached. */
  word: Word & { help?: string };
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
    // Scroll closes the panel, because it is positioned against the word and
    // would otherwise drift away from it. A small scroll is a finger resting or
    // a tap landing, not a decision to read on, and treating those as "close"
    // meant a child could open a definition and lose it before they could press
    // the button inside it.
    let lastScroll = 0;
    const reposition = () => {
      const now = Date.now();
      if (now - lastScroll < 120) return;
      lastScroll = now;
      close(Boolean(note.current?.contains(document.activeElement)));
    };
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
  // Deliberately no hover handlers. Sliding the cursor down a paragraph of
  // story used to flash a help panel open and shut over each bold word it
  // passed, which is unreadable on a page someone is trying to read. Tap or
  // focus opens it, and a pointer user can still click.
  return (
    <span className="story-word-wrap">
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
            {/* The help is worked out on the server; the definition is the
                fallback for a word the help file does not cover. */}
            <span>{word.help || word.definition}</span>
            <Pronunciation word={word.word} id={word.id} />
            {has(related.syn) && (
              <span>
                <b>Similar words (synonyms):</b> {related.syn}
              </span>
            )}
            {has(related.ant) && (
              <span>
                <b>Opposite words (antonyms):</b> {related.ant}
              </span>
            )}
            {word.example && (
              <span className="story-word-example">
                <b>Example:</b> {word.example}
              </span>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
