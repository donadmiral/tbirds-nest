"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "pc:theme";
const ThemeContext = createContext<{ theme: Theme; choose: (theme: Theme) => void } | null>(null);
// Browser-only preference store; the server snapshot is always deterministic.
let sessionTheme: Theme | null = null;
const listeners = new Set<() => void>();

function normalizeTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  if (sessionTheme !== null) return sessionTheme;
  try { return normalizeTheme(window.localStorage.getItem(THEME_KEY)); }
  catch { return "system"; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function chooseTheme(next: Theme) {
  sessionTheme = next;
  applyTheme(next);
  try { window.localStorage.setItem(THEME_KEY, next); }
  catch { /* Apply for this session even when persistence is unavailable. */ }
  listeners.forEach(listener => listener());
}

function serverTheme(): Theme { return "system"; }

/** Keep system appearance live on every route, including before Settings opens. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      sessionTheme = normalizeTheme(event.newValue);
      applyTheme(sessionTheme);
      listeners.forEach(listener => listener());
    };
    // Read the browser snapshot here so hydration's server snapshot cannot
    // briefly override an explicit saved choice with the device preference.
    applyTheme(readTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system"); };
    window.addEventListener("storage", onStorage);
    media.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      media.removeEventListener("change", onChange);
    };
  }, []);

  return <ThemeContext.Provider value={{ theme, choose: chooseTheme }}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Theme controls require ThemeProvider");
  return value;
}
