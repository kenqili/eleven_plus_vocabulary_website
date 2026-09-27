/**
 * The chosen theme, as a store rather than component state.
 *
 * The value lives on the document, because that is what the tokens cascade
 * from and because the inline script in the layout writes it before first
 * paint. Reading it through useSyncExternalStore means React is told the
 * value changed rather than being handed it during render, which is what
 * keeps a stored dark theme from flashing white on load.
 */
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeId,
} from "./themes";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Watches the document so a change from anywhere, including the inline
 *  script and another tab, reaches the switcher. */
let observer: MutationObserver | null = null;
const watch = () => {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(() => {
    for (const listener of listeners) listener();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
};

export const subscribeToTheme = (listener: Listener) => {
  listeners.add(listener);
  watch();
  // Another tab changing the theme should change it here too.
  const storage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
    if (!listeners.size && observer) {
      observer.disconnect();
      observer = null;
    }
  };
};

export const readTheme = (): string => {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const applied = document.documentElement.getAttribute("data-theme");
  return isThemeId(applied) ? applied : DEFAULT_THEME;
};

/** The server has no document and no storage, so it always sees the default. */
export const readThemeOnServer = () => DEFAULT_THEME;

export function writeTheme(id: string) {
  if (typeof document === "undefined" || !isThemeId(id)) return;
  document.documentElement.setAttribute("data-theme", id);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Storage blocked: the theme still applies for this visit.
  }
  for (const listener of listeners) listener();
}
