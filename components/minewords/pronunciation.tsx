"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { releaseAudio, takeAudio } from "@/lib/client/audio";
import { pauseAutoNext } from "@/lib/client/auto-next";
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
export default function Pronunciation({
  word,
  id = word.toLowerCase(),
}: {
  word: string;
  id?: string;
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
        aria-label={`Hear ${word} pronounced in British English`}
        onClick={() => void play()}
      >
        <Volume2 size={18} aria-hidden="true" />
        {playing ? "Playing…" : "Hear this word"}
      </button>
      {notice && <span role="status">{notice}</span>}
    </span>
  );
}
