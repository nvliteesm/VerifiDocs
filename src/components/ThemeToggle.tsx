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
    setDark(saved === "dark" ? true : saved === "light" ? false : systemPrefersDark());
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
