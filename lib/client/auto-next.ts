const key = "minewords.next-delay";
export type NextDelay = 0 | 5 | 10;
let fallback: NextDelay = 0;
const listeners = new Set<() => void>();
export function readAutoNext(): NextDelay {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null)
      return localStorage.getItem("minewords.auto-next") === "true" ? 5 : 0;
    return stored === "5" ? 5 : stored === "10" ? 10 : 0;
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
