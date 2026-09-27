"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useSoundToggle } from "./sound-toggle";
import {
  CLASSIC_VOICE,
  SOUNDS,
  VOICE_FOR_THEME,
  isSoundName,
  isTooSoon,
  type SoundName,
  type Voice,
} from "./sounds";

type SoundContextValue = {
  play: (name: SoundName) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);

/** The events browsers accept as the gesture needed before audio may start. */
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

const createAudio = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/**
 * Plays the practice sounds.
 *
 * The audio context is only created from a real gesture, because browsers
 * refuse otherwise, so the first tap unlocks sound for the rest of the
 * session. Nothing is created until sound is switched on, and the device is
 * released when this provider goes away.
 */
export function SoundProvider({ children }: { children: React.ReactNode }) {
  const { on, setOn } = useSoundToggle();
  const context = useRef<AudioContext | null>(null);
  const voice = useRef<Voice>(CLASSIC_VOICE);
  /** True once a gesture has happened. Not the same as the context running. */
  const unlocked = useRef(false);
  /** When the last feedback sound started, so a fast tap cannot pile them up. */
  const lastStarted = useRef<number | null>(null);

  // The voice follows the theme, so the app sounds like it looks. A theme
  // chosen from the menu changes the voice without a rebuild.
  useEffect(() => {
    const readTheme = () => {
      const id = document.documentElement.getAttribute("data-theme") ?? "classic";
      voice.current = VOICE_FOR_THEME[id] ?? CLASSIC_VOICE;
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const play = useCallback(
    (name: SoundName) => {
      if (!unlocked.current || !isSoundName(name)) return;
      const audio = context.current;
      if (!audio || audio.state !== "running") return;
      const sound = SOUNDS[name];
      const now = voice.current;
      // Drop a sound that lands while the last one is still ringing. A missing
      // click goes unnoticed; a pile of them does not.
      if (isTooSoon(lastStarted.current, audio.currentTime, now, name)) return;
      lastStarted.current = audio.currentTime;

      /** One short pitched blip with a hard decay. */
      const blip = (
        frequency: number,
        at: number,
        length: number,
        wave: OscillatorType,
        level: number,
      ) => {
        const start = audio.currentTime + at;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(frequency, start);
        // A quick attack and an exponential decay, so notes do not pile into
        // mush when a fast child answers four questions in ten seconds.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(level, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + length + 0.02);
      };

      if (name === "turn-page") {
        // A noise burst through a swept bandpass, which is about as close as a
        // synthesiser gets to the sound of turning a page.
        const start = audio.currentTime;
        const frames = Math.max(1, Math.floor(audio.sampleRate * 0.16));
        const buffer = audio.createBuffer(1, frames, audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i += 1) {
          // Fade in and out, so it is a rustle rather than a click.
          const shape = Math.sin((Math.PI * i) / frames) ** 2;
          data[i] = (Math.random() * 2 - 1) * shape * 0.5;
        }
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(2600, start);
        filter.frequency.exponentialRampToValueAtTime(700, start + 0.16);
        gain.gain.setValueAtTime(now.level * 0.5, start);
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(audio.destination);
        source.start(start);
        return;
      }

      for (const step of sound.steps ?? [])
        blip(
          now.pitch * 2 ** (step.semitones / 12) * now.sweep,
          step.at,
          now.length * (step.length ?? 1),
          sound.wave ?? now.edge,
          now.level,
        );
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!on) {
      unlocked.current = false;
      void context.current?.suspend();
      return;
    }
    const unlock = () => {
      context.current ??= createAudio();
      const audio = context.current;
      if (!audio) return;
      // resume() is asynchronous, so the state cannot be checked here. What
      // this flag really records is that a gesture has happened; play() still
      // refuses to make a sound until the context is genuinely running.
      if (audio.state === "suspended") void audio.resume();
      unlocked.current = true;
    };
    for (const event of GESTURES)
      window.addEventListener(event, unlock, { passive: true });
    return () => {
      for (const event of GESTURES) window.removeEventListener(event, unlock);
    };
  }, [on]);

  // A hidden tab should not leave a blip pending, and a visible one picks up
  // again where it left off.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      const audio = context.current;
      if (!audio) return;
      if (document.hidden) void audio.suspend();
      else if (on) void audio.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [on]);

  // Release the audio device rather than holding it open for the life of the tab.
  useEffect(
    () => () => {
      unlocked.current = false;
      lastStarted.current = null;
      const audio = context.current;
      context.current = null;
      if (audio) void audio.close();
    },
    [],
  );

  const value = useMemo(() => ({ play, on, setOn }), [play, on, setOn]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function usePlaySound(): (name: SoundName) => void {
  return useContext(SoundContext)?.play ?? (() => {});
}
