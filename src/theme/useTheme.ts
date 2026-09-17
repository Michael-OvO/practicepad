import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getStorage } from "../storage";
import { THEME_KEY, parseThemePreference, resolveTheme, type ResolvedTheme, type ThemePreference } from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

export interface ThemeControls {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
  toggle(): void;
}

export function useTheme(): ThemeControls {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    parseThemePreference(getStorage()?.getItem(THEME_KEY) ?? null),
  );
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark);
  const theme = resolveTheme(preference, prefersDark);

  // index.html sets this attribute before first paint; keep it in step afterwards.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") getStorage()?.removeItem(THEME_KEY);
      else getStorage()?.setItem(THEME_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  }, []);

  const toggle = useCallback(() => setPreference(theme === "dark" ? "light" : "dark"), [setPreference, theme]);

  return { preference, theme, setPreference, toggle };
}
