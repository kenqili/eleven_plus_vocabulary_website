const key = "minewords.auto-next";
let fallback = false;
const listeners = new Set<() => void>();
export function readAutoNext() {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return fallback;
  }
}
export function saveAutoNext(value: boolean) {
  fallback = value;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Keep the preference for this session when browser storage is unavailable.
  }
  listeners.forEach((notify) => notify());
}
export function subscribeAutoNext(notify: () => void) {
  listeners.add(notify);
  const changed = (event: StorageEvent) => {
    if (event.key === key || event.key === null) notify();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", changed);
  };
}
export const serverAutoNext = () => false;
