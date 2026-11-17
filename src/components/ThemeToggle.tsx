"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, writeStored } from "./storage";

// The page starts in whatever the system prefers (see the inline script in layout.tsx, which applies a saved choice
// before first paint so there is no flash). This switch lets the student override it and remembers the choice.
function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === "dark" || saved === "light") {
      setDark(saved === "dark");
      return;
    }
    setDark(systemPrefersDark());
    // Until the student chooses, the page follows the system (for example an automatic switch at sunset), so the
    // switch must follow it too. Once they choose, data-theme is set and the system no longer matters.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (!document.documentElement.dataset.theme) setDark(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    writeStored(THEME_KEY, next ? "dark" : "light");
  }

  return (
    <button type="button" role="switch" aria-checked={dark === true} className="theme" onClick={toggle} disabled={dark === null}>
      <span>Dark mode</span>
      <span className="theme-track" aria-hidden="true" />
    </button>
  );
}
