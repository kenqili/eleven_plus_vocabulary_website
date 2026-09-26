"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Pause, Play } from "lucide-react";
import { releaseAudio, takeAudio } from "@/lib/client/audio";
import { pauseAutoNext } from "@/lib/client/auto-next";
let manifest: Promise<Record<string, string | null>> | undefined;
function storyFiles() {
  return (manifest ??= fetch("/audio/stories/manifest.json")
    .then(async (response) => {
      if (!response.ok) throw new Error("Story audio unavailable");
      const data = (await response.json()) as {
        stories: Record<string, string | null>;
      };
      return data.stories;
    })
    .catch((error) => {
      manifest = undefined;
      throw error;
    }));
}
export default function StoryAudio({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = useRef<HTMLAudioElement | null>(null);
  const alive = useRef(true);
  const stop = useRef(() => {});
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current();
    };
  }, []);
  async function play() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const url = (await storyFiles())[id];
      if (!alive.current) return;
      if (!url) {
        setNotice("This story is still being recorded. Try again soon.");
        return;
      }
      const audio = new Audio(url);
      own.current = audio;
      stop.current = () => {
        audio.pause();
        audio.currentTime = 0;
      };
      takeAudio(stop.current);
      audio.onended = audio.onpause = () => {
        releaseAudio(stop.current);
        if (alive.current) setPlaying(false);
      };
      audio.onerror = () => {
        releaseAudio(stop.current);
        if (alive.current) {
          setPlaying(false);
          setNotice("Couldn’t play that story. Tap Listen again to retry.");
        }
      };
      pauseAutoNext();
      await audio.play();
      if (!alive.current) {
        audio.pause();
        return;
      }
      setPlaying(true);
    } catch {
      if (alive.current) {
        setPlaying(false);
        setNotice("Couldn’t play that story. Tap Listen again to retry.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function pause() {
    stop.current();
    releaseAudio(stop.current);
    setPlaying(false);
  }
  return (
    <div className="story-audio">
      <button
        type="button"
        className="text-button story-audio-button"
        aria-label={
          playing
            ? `Pause the story ${title}`
            : `Listen to the story ${title} read aloud`
        }
        disabled={busy}
        onClick={() => (playing ? pause() : void play())}
      >
        {playing ? (
          <Pause size={18} aria-hidden="true" />
        ) : (
          <Play size={18} aria-hidden="true" />
        )}
        {playing ? "Pause story" : busy ? "Getting story…" : "Listen to story"}
      </button>
      <p className="story-audio-note">
        {notice ? (
          <span role="status">{notice}</span>
        ) : (
          <>
            <BookOpen size={16} aria-hidden="true" />
            Read along if you like
          </>
        )}
      </p>
    </div>
  );
}
