"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALE_KEY, detectLocale, translatorFor, type Locale, type Translate } from "@/lib/i18n";
import { readStored, writeStored } from "./storage";

interface LocaleValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  /** False until the saved or browser language has been read, so a page never flashes the wrong language. */
  ready: boolean;
}

// With no provider (a component rendered on its own in a test), everything is English and ready.
const fallback: LocaleValue = { locale: "en", setLocale: () => {}, t: translatorFor("en"), ready: true };
const LocaleContext = createContext<LocaleValue>(fallback);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [ready, setReady] = useState(false);

  // The saved choice and the browser's languages live in the browser, which the server cannot read, so they are
  // read after mount. Reading them during render would make the server and the first client render disagree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(detectLocale(readStored(LOCALE_KEY), navigator.languages?.length ? navigator.languages : [navigator.language]));
    setReady(true);
  }, []);

  // Tell the browser and screen readers which language the page is in.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStored(LOCALE_KEY, next);
  }, []);

  const value = useMemo<LocaleValue>(() => ({ locale, setLocale, t: translatorFor(locale), ready }), [locale, setLocale, ready]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleValue {
  return useContext(LocaleContext);
}
