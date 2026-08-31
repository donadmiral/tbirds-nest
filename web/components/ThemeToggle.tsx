"use client";

/**
 * Appearance: light, dark, or follow the system.
 *
 * The choice is stored in localStorage and applied as a class on <html>. The
 * root layout runs a tiny inline script before paint that applies the saved
 * choice, so a dark user never sees a white flash on load.
 */
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "pc:theme";

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = (window.localStorage.getItem(THEME_KEY) as Theme | null) ?? "light";
    setTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if ((window.localStorage.getItem(THEME_KEY) ?? "light") === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const choose = (t: Theme) => {
    setTheme(t);
    window.localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
  };
  const opts: { key: Theme; label: string; icon: typeof Sun }[] = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];
  return (
    <div className="flex gap-1 rounded-full bg-surface p-1">
      {opts.map((o) => (
        <button key={o.key} onClick={() => choose(o.key)}
          className={"flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (theme === o.key ? "bg-white text-ink shadow-sm" : "text-ink/60 hover:text-ink")}>
          <o.icon size={13} /> {o.label}
        </button>
      ))}
    </div>
  );
}
