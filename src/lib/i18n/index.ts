// Translation helpers. No library: the product has two languages and a few hundred short lines (messages.ts).
import { MESSAGES, type Locale, type MessageKey } from "./messages";

export { MESSAGES } from "./messages";
export type { Locale, MessageKey } from "./messages";

export const LOCALES: readonly Locale[] = ["en", "id"];
/** Where the student's choice is remembered in this browser. */
export const LOCALE_KEY = "verifidocs.locale";

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

/** Replaces each {name} in a message with its value. An unknown {name} is left as it is, so a gap shows up in tests. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const text = MESSAGES[locale][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function translatorFor(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

/** The keys that come in `.one` and `.other` pairs, without the suffix. */
export type PluralBase = MessageKey extends infer K ? (K extends `${infer Base}.one` ? Base : never) : never;

/** The key to use for a count. Indonesian has no plural, and its `.one` and `.other` are the same. */
export function pluralKey(locale: Locale, base: PluralBase, n: number): MessageKey {
  return `${base}.${locale === "en" && n === 1 ? "one" : "other"}` as MessageKey;
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "id";
}

/**
 * Which language to start in: the student's saved choice, else Indonesian when the browser lists Indonesian first
 * among the languages we offer, else English. ("in" is the old code some browsers still send for Indonesian.)
 */
export function detectLocale(saved: string | null | undefined, browserLanguages: readonly string[] | undefined): Locale {
  if (isLocale(saved)) return saved;
  for (const language of browserLanguages ?? []) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "id" || base === "in") return "id";
    if (base === "en") return "en";
  }
  return "en";
}
