"use client";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { THEMES, type Theme } from "./themes";
import {
  readTheme,
  readThemeOnServer,
  subscribeToTheme,
  writeTheme,
} from "./theme-store";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const FALLBACK = THEMES[0];

/**
 * Applies the theme to the document and remembers the choice. The attribute is
 * set on <html> so the tokens cascade into everything.
 *
 * The value is read from the document rather than from React state, because
 * the inline script in the layout has already applied it by the time this
 * runs. Reading it through useSyncExternalStore means the server render and
 * the first client render agree, so a child who chose a dark theme never sees
 * a white frame.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const id = useSyncExternalStore(
    subscribeToTheme,
    readTheme,
    readThemeOnServer,
  );
  const setTheme = useCallback((next: string) => writeTheme(next), []);
  const value = useMemo(
    () => ({ theme: THEMES.find((entry) => entry.id === id) ?? FALLBACK, setTheme }),
    [id, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? { theme: FALLBACK, setTheme: () => {} };
}
