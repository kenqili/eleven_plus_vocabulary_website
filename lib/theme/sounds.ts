/**
 * The sounds practice makes.
 *
 * These are synthesised in the browser rather than shipped as audio files, for
 * three reasons. There is no licence to worry about, there is nothing to
 * download, and the timbre can follow the theme, so the Blocky theme really
 * does sound blocky rather than being the same chime recoloured.
 *
 * The idea behind the timbres is a short pitched blip with a hard edge, closer
 * to a game than to an orchestral sample. Every sound is built from a handful
 * of oscillators and a gain envelope, which is enough to be distinct at a
 * glance and cheap enough to play on a locked-down school laptop.
 */
export type SoundName =
  | "select"
  | "correct"
  | "wrong"
  | "hint"
  | "streak"
  | "mastered"
  | "level-up"
  | "reveal"
  | "turn-page"
  | "reward";

/** A theme's voice: the numbers the sound shapes are built from. */
export type Voice = {
  /** Base pitch in hertz for a single blip. */
  pitch: number;
  /** How square the wave is. 0 is a sine, 1 is as square as it gets. */
  edge: OscillatorType;
  /** Relative length of a blip, in seconds. */
  length: number;
  /** How much pitch sweeps across a blip, as a ratio of the base. */
  sweep: number;
  /** Level for the whole voice, 0 to 1. */
  level: number;
};

/** The default voice: a soft marimba-like tone, not a beep. */
export const CLASSIC_VOICE: Voice = {
  pitch: 620,
  edge: "triangle",
  length: 0.16,
  sweep: 1.18,
  level: 0.5,
};

/**
 * The Blocky voice. Square waves, a lower base and a wider sweep, which is what
 * makes a sound read as a game rather than a school app.
 */
export const BLOCKY_VOICE: Voice = {
  pitch: 440,
  edge: "square",
  length: 0.13,
  sweep: 1.45,
  level: 0.4,
};

/** A step in a melody: a frequency ratio, so a scale is a list of small numbers. */
const SEMITONE = Math.pow(2, 1 / 12);
const note = (semitones: number) => SEMITONE ** semitones;

export type Sound = {
  /**
   * Each entry is one blip, a semitone offset from the voice's base pitch.
   * Absent for a sound that is noise rather than notes.
   */
  steps?: readonly { semitones: number; at: number; length?: number }[];
  /** The wave each blip uses, overriding the voice's. */
  wave?: OscillatorType;
  /**
   * Seconds of filtered noise instead of notes. A sound with noise has no
   * steps, because it is a texture rather than a pitch.
   */
  noiseSeconds?: number;
};

export const SOUNDS: Record<SoundName, Sound> = {
  /**
   * A quiet blip under a tap. Barely a sound, mostly reassurance. Deliberately
   * the only sound with a single note and no shape, so it never reads as a
   * verdict on the answer.
   */
  select: { steps: [{ semitones: 0, at: 0, length: 0.85 }] },
  /**
   * A rising third. A major third sounds like a result, a minor one sounds
   * like a question, and this needs to sound like a result.
   */
  correct: { steps: [{ semitones: 0, at: 0 }, { semitones: 4, at: 0.07 }] },
  /** A single falling blip. Deliberately not harsh: a wrong answer is not a punishment. */
  wrong: { steps: [{ semitones: 3, at: 0, length: 1.5 }, { semitones: -2, at: 0.09 }] },
  /**
   * Asking the listener to lean in.
   *
   * It rises and then falls back, which is a question mark. A purely rising
   * hint would sound like a correct answer, and a child who cannot recall the
   * word must never hear the sound for getting it right.
   */
  hint: {
    steps: [
      { semitones: -5, at: 0 },
      { semitones: 0, at: 0.09 },
      { semitones: -3, at: 0.18, length: 1.5 },
    ],
  },
  /** A quick three-step lift, the sound of something building. */
  streak: {
    steps: [
      { semitones: 0, at: 0 },
      { semitones: 4, at: 0.06 },
      { semitones: 7, at: 0.12 },
    ],
  },
  /** A full rising run, for a word finally learned. */
  mastered: {
    steps: [
      { semitones: 0, at: 0 },
      { semitones: 4, at: 0.08 },
      { semitones: 7, at: 0.16 },
      { semitones: 12, at: 0.24 },
    ],
  },
  /** Wider and slower than mastered, because this is a bigger moment. */
  "level-up": {
    steps: [
      { semitones: 0, at: 0 },
      { semitones: 5, at: 0.1 },
      { semitones: 9, at: 0.2 },
      { semitones: 12, at: 0.3 },
      { semitones: 16, at: 0.42 },
    ],
  },
  /**
   * Turning the card over rather than a failure.
   *
   * One soft note that falls very slightly. It must not rise, because rising
   * is how this app says "correct", and a child who used the hint should never
   * hear the reward for an answer they did not give.
   */
  reveal: { steps: [{ semitones: -1, at: 0, length: 1.4 }] },
  /** Paper, sort of. A noise burst with a downward filter sweep. */
  "turn-page": { noiseSeconds: 0.16 },
  /** The reward sound, which is the one allowed to be a little bit smug. */
  reward: {
    steps: [
      { semitones: 0, at: 0 },
      { semitones: 4, at: 0.07 },
      { semitones: 7, at: 0.14 },
      { semitones: 12, at: 0.21 },
      { semitones: 11, at: 0.3 },
      { semitones: 12, at: 0.36 },
    ],
  },
};

export const isSoundName = (value: unknown): value is SoundName =>
  typeof value === "string" && Object.hasOwn(SOUNDS, value);

/** The voice each theme plays in, so the app sounds like it looks. */
export const VOICE_FOR_THEME: Record<string, Voice> = {
  classic: CLASSIC_VOICE,
  minecraft: BLOCKY_VOICE,
  // Warm themes get a rounder, longer voice rather than the default.
  sunshine: { ...CLASSIC_VOICE, pitch: 700, edge: "sine", length: 0.2, level: 0.45 },
  midnight: { ...CLASSIC_VOICE, pitch: 520, edge: "sine", length: 0.22, level: 0.4 },
};

/**
 * The whole sequence for a sound, as absolute times and frequencies. Split out
 * from playing it so the shape can be tested without an audio device, which
 * matters because an inaudible mistake is otherwise invisible.
 */
export type Plotted = {
  at: number;
  frequency: number;
  length: number;
  wave: OscillatorType;
  level: number;
};

export const plot = (name: SoundName, voice: Voice = CLASSIC_VOICE): Plotted[] => {
  const sound = SOUNDS[name];
  // A noise sound has no pitches, so there is nothing to plot.
  return (sound.steps ?? []).map((step) => ({
    at: step.at,
    frequency: voice.pitch * note(step.semitones) * voice.sweep,
    length: voice.length * (step.length ?? 1),
    wave: sound.wave ?? voice.edge,
    level: voice.level,
  }));
};

/** How long a sound lasts, so a caller can time a visual to the same beat. */
export const duration = (name: SoundName, voice: Voice = CLASSIC_VOICE) => {
  const sound = SOUNDS[name];
  if (sound.noiseSeconds) return sound.noiseSeconds;
  const plotted = plot(name, voice);
  if (!plotted.length) return voice.length;
  return Math.max(...plotted.map((entry) => entry.at + entry.length));
};

/**
 * The shortest gap between two sounds. A child answering quickly must not get
 * a wall of overlapping tones, so a new sound is dropped if the last one is
 * still ringing. Dropping is the right call: a missing click is noticed far
 * less than a pile of them is.
 */
export const RETRIGGER_GAP_SECONDS = 0.06;

/** True when a sound should be dropped because the previous one is still going. */
export const isTooSoon = (
  lastStartedAt: number | null,
  now: number,
  voice: Voice = CLASSIC_VOICE,
  name?: SoundName,
) => {
  if (lastStartedAt === null) return false;
  // The feedback sounds are the ones worth protecting; a tap click is not.
  if (name === "select") return false;
  return now - lastStartedAt < Math.max(RETRIGGER_GAP_SECONDS, voice.length * 0.5);
};
