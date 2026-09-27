"use client";
import { Check, Palette, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/theme-provider";
import { usePlaySound } from "@/lib/theme/sound-provider";
import { useSoundToggle } from "@/lib/theme/sound-toggle";
import { THEMES } from "@/lib/theme/themes";

/**
 * Picks the look of the app, and the sound.
 *
 * Four swatches, one tap each, and the choice is remembered. There is
 * deliberately no live preview on hover: a child changing the theme of a page
 * they are reading should see the page they are reading, not a flicker of
 * something else.
 *
 * Sounds are off until asked for, and switching them on plays a sample so the
 * choice is informed rather than a guess.
 */
export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const { on: soundOn, setOn: setSoundOn } = useSoundToggle();
  const play = usePlaySound();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={wrap}>
      <button
        type="button"
        className="theme-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Palette size={17} aria-hidden />
        <span>{theme.label}</span>
      </button>
      {open ? (
        <div className="theme-menu" role="menu" aria-label="Choose a look">
          <p className="theme-menu-note">
            Pick the look that suits you. It only changes how the app looks.
          </p>
          {THEMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme.id === entry.id}
              className="theme-option"
              onClick={() => {
                setTheme(entry.id);
                setOpen(false);
              }}
            >
              <span className="theme-swatch" aria-hidden>
                {entry.swatch.map((colour) => (
                  <span key={colour} style={{ background: colour }} />
                ))}
              </span>
              <span className="theme-option-text">
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
              {theme.id === entry.id ? (
                <Check size={17} aria-hidden className="theme-check" />
              ) : null}
            </button>
          ))}
          <div className="theme-sound">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={soundOn}
              className="theme-option"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                // The sample is deliberately after the state change, so the
                // first sound a child hears is the one they just turned on.
                if (next) setTimeout(() => play("correct"), 60);
              }}
            >
              <span className="theme-sound-icon" aria-hidden>
                {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </span>
              <span className="theme-option-text">
                <strong>Sounds</strong>
                <small>
                  {soundOn
                    ? "Short game sounds when you answer."
                    : "Off. Turn on for short game sounds."}
                </small>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
