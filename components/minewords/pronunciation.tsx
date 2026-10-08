"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { releaseAudio, takeAudio } from "@/lib/client/audio";
import { pauseAutoNext } from "@/lib/client/auto-next";
import { prefetchWhenIdle } from "@/lib/client/prefetch-idle";
let activeAudio: HTMLAudioElement | null = null;
let sequence = 0;
export function isPronouncing() {
  return Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended);
}
let manifest: Promise<Record<string, string | null>> | undefined;
function audioFiles() {
  return (manifest ??= fetch("/audio/vocabulary/manifest.json")
    .then(async (response) => {
      if (!response.ok) throw new Error("Audio catalogue unavailable");
      const data = (await response.json()) as {
        words: Record<string, string | null>;
      };
      return data.words;
    })
    .catch((error) => {
      manifest = undefined;
      throw error;
    }));
}

/**
 * Whether a pronunciation clip exists, so callers can skip dead buttons.
 *
 * Many synonym/antonym answers are real words with no recording (only the
 * 2,249 bank words have clips). Showing the control for those would be a
 * button that always answers "being prepared", so the answer line checks
 * first. Reads the same cached manifest the control itself plays from, so
 * this costs no extra request.
 */
export function hasPronunciation(id: string): Promise<boolean> {
  return audioFiles().then(
    (words) => Boolean(words[id]),
    () => false,
  );
}

/**
 * Warms the index once per page, not once per word.
 *
 * Every Listen control on a screen shares one fetch, so warming it from each
 * would be the same request many times. The control that is actually pressed
 * reads the same promise and gets the cached response.
 */
export function WarmAudioIndex() {
  useEffect(() => {
    prefetchWhenIdle("/audio/vocabulary/manifest.json");
  }, []);
  return null;
}
export default function Pronunciation({
  word,
  id = word.toLowerCase(),
  label,
}: {
  word: string;
  id?: string;
  /**
   * What a screen reader calls the button. Defaults to the question-word
   * wording; the answer line passes its own, so the two controls on one
   * answered question never share a name.
   */
  label?: string;
}) {
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const own = useRef<HTMLAudioElement | null>(null);
  // Kept in a ref so the shared coordinator always sees the same callback and
  // can recognise this clip when it stops.
  const stop = useRef<() => void>(() => {});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      own.current?.pause();
    };
  }, []);
  async function play() {
    const request = ++sequence;
    pauseAutoNext();
    setNotice("");
    activeAudio?.pause();
    try {
      const url = (await audioFiles())[id];
      if (!alive.current || request !== sequence) return;
      if (!url) {
        setNotice("This pronunciation is being prepared.");
        return;
      }
      const audio = new Audio(url);
      activeAudio = audio;
      own.current = audio;
      // Hearing a word mid-narration should quieten the story, not talk over it.
      stop.current = () => audio.pause();
      takeAudio(stop.current);
      audio.onended = audio.onpause = () => {
        releaseAudio(stop.current);
        if (alive.current) setPlaying(false);
      };
      audio.onerror = () => {
        releaseAudio(stop.current);
        if (alive.current) {
          setPlaying(false);
          setNotice("Couldn’t play that word. Tap Hear this word to retry.");
        }
      };
      await audio.play();
      if (!alive.current || request !== sequence) {
        audio.pause();
        return;
      }
      setPlaying(true);
    } catch {
      if (alive.current && request === sequence) {
        setPlaying(false);
        setNotice("Couldn’t play that word. Tap Hear this word to retry.");
      }
    }
  }
  return (
    <span className="pronunciation">
      <button
        type="button"
        className="text-button pronunciation-button"
        aria-label={label ?? `Hear ${word} pronounced in British English`}
        onClick={() => void play()}
      >
        <Volume2 size={18} aria-hidden="true" />
        {playing ? "Playing…" : "Hear this word"}
      </button>
      {notice && <span role="status">{notice}</span>}
    </span>
  );
}

/**
 * The answer, playable — but only when there is something to play.
 *
 * Rendered for single-word answers (a definition is a sentence, not a word).
 * Answers that are real words without a recording render nothing at all
 * rather than a button that can only apologise.
 */
export function AnswerAudio({ word }: { word: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasPronunciation(word.toLowerCase()).then((ok) => {
      if (alive) setReady(ok);
    });
    return () => {
      alive = false;
    };
  }, [word]);
  if (!ready) return null;
  return (
    <Pronunciation
      word={word}
      label={`Hear the answer ${word} pronounced in British English`}
    />
  );
}
