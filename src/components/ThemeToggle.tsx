"use client";

import { useEffect, useState } from "react";
import { useT } from "./LocaleProvider";
import { THEME_KEY, writeStored } from "./storage";

// The page starts in whatever the system prefers (see the inline script in layout.tsx, which applies a saved choice
// before first paint so there is no flash). This switch lets the student override it and remembers the choice.
function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  const { t } = useT();
  const [dark, setDark] = useState<boolean | null>(null);

  // The theme is only known in the browser (a saved choice, or the system setting), so it is read after mount;
  // reading it during render would make the server and the first client render disagree.
  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    writeStored(THEME_KEY, next ? "dark" : "light");
  }

  return (
    <button type="button" role="switch" aria-checked={dark === true} className="theme" onClick={toggle} disabled={dark === null}>
      <span>{t("theme.dark")}</span>
      <span className="theme-track" aria-hidden="true" />
    </button>
  );
}
