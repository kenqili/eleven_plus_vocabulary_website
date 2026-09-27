// The practice sounds are synthesised, so their shape is data. These check the
// things a listener would notice, because a silent mistake in a sound is
// otherwise impossible to see.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKY_VOICE,
  CLASSIC_VOICE,
  RETRIGGER_GAP_SECONDS,
  SOUNDS,
  VOICE_FOR_THEME,
  duration,
  isSoundName,
  isTooSoon,
  plot,
} from "../lib/theme/sounds.ts";
import { DEFAULT_THEME, THEMES } from "../lib/theme/themes.ts";

const names = Object.keys(SOUNDS);

test("every sound is defined and reachable", () => {
  assert.ok(names.length >= 8, `only ${names.length} sounds defined`);
  for (const name of names) {
    assert.ok(isSoundName(name), name);
    const sound = SOUNDS[name];
    const isNoise = Boolean(sound.noiseSeconds);
    if (!isNoise) assert.ok(sound.steps.length > 0, `${name} has no notes`);
    else
      assert.ok(
        !sound.steps?.length,
        `${name} is noise and must not also carry notes`,
      );
    for (const step of sound.steps ?? []) {
      assert.ok(step.at >= 0, `${name}: a note cannot start before now`);
      assert.ok(Number.isInteger(step.semitones), name);
      assert.ok((step.length ?? 1) > 0, name);
    }
  }
  assert.equal(isSoundName("nope"), false);
  assert.equal(isSoundName(undefined), false);
  assert.equal(isSoundName("CORRECT"), false, "names are exact, not fuzzy");
});

test("a sound's notes are in order and overlap only slightly", () => {
  for (const name of names) {
    const steps = SOUNDS[name].steps ?? [];
    if (!steps.length) continue;
    for (let i = 1; i < steps.length; i += 1)
      assert.ok(
        steps[i].at >= steps[i - 1].at,
        `${name}: notes must be listed in time order`,
      );
    // Notes inside one sound may overlap a little, which is what makes an
    // arpeggio sound like a chime rather than a sequence of beeps. They must
    // not stack deeply, and the gap between sounds is policed separately.
    const length = CLASSIC_VOICE.length;
    for (let i = 1; i < steps.length; i += 1) {
      const overlap =
        steps[i - 1].at + (steps[i - 1].length ?? 1) * length - steps[i].at;
      assert.ok(overlap <= length, `${name}: note ${i} is buried under the previous`);
      assert.ok(overlap >= 0, `${name}: notes must be listed in time order`);
    }
  }
});

test("nothing is long enough to be annoying or too short to hear", () => {
  for (const name of names) {
    const seconds = duration(name);
    // select is a click under a tap, and is meant to sit under the threshold of
    // notice. Everything else has to be heard.
    const floor = name === "select" ? 0.08 : 0.1;
    assert.ok(seconds > floor, `${name} is ${seconds}s, too short to notice`);
    assert.ok(seconds < 1.2, `${name} is ${seconds}s, too long for feedback`);
  }
});

test("a correct answer rises and a wrong one falls", () => {
  // The whole point of the two sounds: one must not be mistakable for the
  // other, and the ear reads pitch direction faster than timbre.
  const correct = plot("correct");
  const wrong = plot("wrong");
  assert.ok(
    correct.at(-1).frequency > correct[0].frequency,
    "correct must go up",
  );
  assert.ok(wrong.at(-1).frequency < wrong[0].frequency, "wrong must go down");
  // And they must be distinguishable in length as well as pitch.
  assert.notEqual(Math.round(duration("correct") * 100), Math.round(duration("wrong") * 100));
});

test("mastering a word is a bigger moment than answering correctly", () => {
  assert.ok(duration("mastered") > duration("correct"));
  assert.ok(duration("level-up") >= duration("mastered"));
  assert.ok(SOUNDS["level-up"].steps.length > SOUNDS.mastered.steps.length);
  assert.ok(SOUNDS.reward.steps.length > SOUNDS.mastered.steps.length);
});

test("revealing the answer is not punished", () => {
  // A child who used the hint should not hear the wrong-answer sound, so the
  // reveal must be a distinct shape rather than a softer wrong.
  const reveal = plot("reveal");
  const wrong = plot("wrong");
  const correct = plot("correct");
  assert.notEqual(reveal.length, wrong.length, "reveal must not be shaped like a wrong answer");
  assert.notEqual(reveal.length, correct.length, "reveal must not be shaped like a correct answer");
  // The decisive check: rising is how this app says correct, so reveal must
  // not rise at all.
  assert.ok(
    reveal.at(-1).frequency <= reveal[0].frequency,
    "reveal must not rise, or it sounds like a correct answer",
  );
  assert.ok(
    correct.at(-1).frequency > correct[0].frequency,
    "correct is the sound that rises, so the two stay distinguishable",
  );
});

test("a hint sounds like asking, not like a result", () => {
  const hint = plot("hint");
  const correct = plot("correct");
  assert.ok(hint.length >= 3, "a hint should be a shape, not one blip");
  // Rising is how this app says correct, so a hint must rise and then fall
  // back. A hint that only went up would sound like a right answer.
  const peak = Math.max(...hint.map((blip) => blip.frequency));
  const last = hint.at(-1).frequency;
  assert.ok(
    last < peak,
    "a hint must fall back from its peak, or it sounds like a correct answer",
  );
  assert.ok(
    correct.at(-1).frequency > correct[0].frequency,
    "correct is the sound that only rises",
  );
  // And it sits lower in pitch, so it reads as a prompt rather than a result.
  assert.ok(hint[0].frequency < correct[0].frequency);
});

test("no sound can be loud enough to startle", () => {
  for (const name of names) {
    for (const blip of plot(name))
      assert.ok(blip.level > 0 && blip.level <= 0.5, `${name}: level ${blip.level}`);
  }
  // The loudest is well under full scale, which is where a phone speaker in a
  // quiet room becomes unpleasant.
  assert.ok(Math.max(...names.flatMap((n) => plot(n).map((b) => b.level))) <= 0.5);
});

test("a theme changes the voice, not just the colour", () => {
  // Every theme has a voice, so switching theme changes what the app sounds
  // like rather than leaving the same chime under a different background.
  for (const theme of THEMES) {
    const voice = VOICE_FOR_THEME[theme.id];
    assert.ok(voice, `${theme.id} has no voice`);
    assert.ok(voice.pitch > 0 && voice.pitch < 4000, theme.id);
    assert.ok(voice.length > 0.05 && voice.length < 0.4, theme.id);
    assert.ok(voice.level > 0 && voice.level <= 0.5, theme.id);
  }
  assert.ok(VOICE_FOR_THEME[DEFAULT_THEME], "the default theme must have a voice");
  assert.equal(VOICE_FOR_THEME.minecraft.edge, "square", "Blocky should sound square");
  assert.notEqual(
    VOICE_FOR_THEME.minecraft.pitch,
    CLASSIC_VOICE.pitch,
    "Blocky should not be the default pitch",
  );
});

test("the Blocky voice is the game-like one without being harsh", () => {
  // Square waves at a sensible level, not at full volume.
  assert.equal(BLOCKY_VOICE.edge, "square");
  assert.ok(BLOCKY_VOICE.sweep > CLASSIC_VOICE.sweep, "a wider sweep reads as a game cue");
  assert.ok(BLOCKY_VOICE.level <= 0.45, "blocky does not mean loud");
  assert.ok(BLOCKY_VOICE.pitch >= 300, "too low and a phone speaker loses it");
});

test("frequencies stay in the range a phone speaker can actually play", () => {
  for (const [name, voice] of Object.entries(VOICE_FOR_THEME))
    for (const sound of names)
      for (const blip of plot(sound, voice)) {
        assert.ok(blip.frequency > 180, `${name}/${sound} is below phone range`);
        assert.ok(blip.frequency < 8000, `${name}/${sound} is above phone range`);
      }
});


test("a sound that lands on top of another is dropped", () => {
  // The real protection against a pile of tones when a child answers fast.
  assert.equal(isTooSoon(null, 10), false, "the first sound always plays");
  assert.equal(isTooSoon(10, 10.01), true, "too soon");
  assert.equal(isTooSoon(10, 10.5), false, "long enough after");
  // A tap click is not a verdict, so it is never dropped for being early.
  assert.equal(isTooSoon(10, 10.001, CLASSIC_VOICE, "select"), false);
  // But a correct answer arriving a moment after another one is dropped.
  assert.equal(isTooSoon(10, 10.001, CLASSIC_VOICE, "correct"), true);
  assert.ok(RETRIGGER_GAP_SECONDS > 0.02, "must be long enough to be audible");
  assert.ok(RETRIGGER_GAP_SECONDS < 0.3, "but not so long it eats real feedback");
});
