"use client";

/**
 * Appearance: light, dark, or follow the system.
 *
 * The choice is stored in localStorage and applied as a class on <html>. The
 * root layout runs a tiny inline script before paint that applies the saved
 * choice, so a dark user never sees a white flash on load.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useThemePreference, type Theme } from "./ThemeProvider";
export { applyTheme, THEME_KEY, type Theme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, choose } = useThemePreference();
  const opts: { key: Theme; label: string; icon: typeof Sun }[] = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dim", icon: Moon },
    { key: "lightsOut", label: "Lights out", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];
  return (
    <div role="group" aria-label="Appearance" className="flex flex-wrap gap-1 rounded-full bg-surface p-1">
      {opts.map((o) => (
        <button type="button" key={o.key} onClick={() => choose(o.key)} aria-pressed={theme === o.key}
          className={"flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (theme === o.key ? "bg-white text-ink shadow-sm" : "text-secondary hover:text-ink")}>
          <o.icon size={13} /> {o.label}
        </button>
      ))}
    </div>
  );
}
