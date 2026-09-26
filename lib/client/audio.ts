// One clip at a time. A word pronunciation and a story narration would
// otherwise speak over each other, so starting either stops the other.
let playing: { stop: () => void } | null = null;

export function takeAudio(stop: () => void) {
  if (playing?.stop === stop) return;
  playing?.stop();
  playing = { stop };
}

export function releaseAudio(stop: () => void) {
  if (playing?.stop === stop) playing = null;
}
