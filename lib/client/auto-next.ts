const key = "minewords.next-delay";
export type NextDelay = 0 | 2 | 4 | 7 | 10;
let fallback: NextDelay = 0;
const listeners = new Set<() => void>();
export const NEXT_DELAYS: NextDelay[] = [0, 2, 4, 7, 10];
export const NEXT_DELAY_LABELS: Record<NextDelay, string> = {
  0: "When I'm ready",
  2: "After 2 seconds",
  4: "After 4 seconds",
  7: "After 7 seconds",
  10: "After 10 seconds",
};

export function readAutoNext(): NextDelay {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null)
      return localStorage.getItem("minewords.auto-next") === "true" ? 4 : 0;
    const parsed = Number(stored);
    return (NEXT_DELAYS as number[]).includes(parsed) ? (parsed as NextDelay) : 0;
  } catch {
    return fallback;
  }
}
export function saveAutoNext(value: NextDelay) {
  fallback = value;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Keep the session preference. */
  }
  listeners.forEach((notify) => notify());
}
export function subscribeAutoNext(notify: () => void) {
  listeners.add(notify);
  const changed = (event: StorageEvent) => {
    if (
      event.key === key ||
      event.key === "minewords.auto-next" ||
      event.key === null
    )
      notify();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", changed);
  };
}
export const serverAutoNext = (): NextDelay => 0;
export function pauseAutoNext() {
  window.dispatchEvent(new Event("minewords:pause-auto-next"));
}
