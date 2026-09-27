"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export const SOUND_STORAGE_KEY = "minewords:sound";

/** Off until asked for. A sound nobody asked for is a sound they will not return for. */
const OFF = "off";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Read once, then cached, so the value is stable between renders. */
let cached: boolean | null = null;
const read = (): boolean => {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    // Storage blocked: behave as though sound is off, and stay consistent.
    cached = false;
  }
  return cached;
};

export const subscribeToSound = (listener: Listener) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key !== SOUND_STORAGE_KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
};

/** The server has no storage, so it always reports sound off. */
export const readSoundOnServer = () => false;
export const readSound = () => read();

export function writeSound(on: boolean) {
  cached = on;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : OFF);
  } catch {
    // Storage blocked: the setting still applies for this visit.
  }
  for (const listener of listeners) listener();
}

type SoundToggleValue = {
  on: boolean;
  setOn: (value: boolean) => void;
};

export function useSoundToggle(): SoundToggleValue {
  const on = useSyncExternalStore(subscribeToSound, readSound, readSoundOnServer);
  const setOn = useCallback((value: boolean) => writeSound(value), []);
  return useMemo(() => ({ on, setOn }), [on, setOn]);
}

/** Test seam: forgets the cached value so a fresh read happens. */
export const __resetSoundCache = () => {
  cached = null;
};
