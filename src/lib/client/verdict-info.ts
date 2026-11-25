// How each of the eight verdicts is shown to a student. The wording follows docs/verdicts.md. A verdict is never
// shown by colour alone: every one has a text label and a symbol as well.
// Text is kept short on purpose: the label says what happened, the reason (written per claim) says why, and the
// advice says what to do. The label and advice live in src/lib/i18n/messages.ts (English and Bahasa Indonesia).
import type { MessageKey, Translate } from "../i18n";
import type { Verdict } from "./types";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export interface VerdictInfo {
  tone: Tone;
  /** A short mark shown beside the label. Decorative: the label carries the meaning. */
  symbol: string;
  /** The icon as an SVG path (24x24, stroked). Decorative: the label carries the meaning. */
  icon: string;
}

export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  supported: { tone: "good", symbol: "✓", icon: "M5 12.5l4.5 4.5L19 7" },
  partial: { tone: "warn", symbol: "≈", icon: "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z M12 4v16" },
  contradicted: { tone: "bad", symbol: "✕", icon: "M6 6l12 12 M18 6L6 18" },
  not_in_sources: { tone: "warn", symbol: "?", icon: "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z M8 12h8" },
  cant_tell: { tone: "muted", symbol: "–", icon: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17h.01" },
  reference_not_found: { tone: "bad", symbol: "!", icon: "M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-.9.9 M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l.9-.9 M4 4l16 16" },
  cant_check: { tone: "info", symbol: "↑", icon: "M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 12h8" },
  no_citation_given: { tone: "info", symbol: "○", icon: "M7 8h4v4a3 3 0 0 1-3 3 M14 8h4v4a3 3 0 0 1-3 3 M4 4l16 16" },
};

/** The short name of a verdict, in the screen's language. */
export function verdictLabel(t: Translate, verdict: Verdict): string {
  return t(`verdict.${verdict}.label` as MessageKey);
}

/** What a verdict means, in one line, in the screen's language. */
export function verdictMeaning(t: Translate, verdict: Verdict): string {
  return t(`verdict.${verdict}.meaning` as MessageKey);
}

/** What the student can do about a verdict, in the screen's language. Empty for Supported. */
export function verdictAdvice(t: Translate, verdict: Verdict): string {
  return t(`verdict.${verdict}.advice` as MessageKey);
}

export function needsAttention(verdict: Verdict | null): boolean {
  return verdict !== null && verdict !== "supported";
}

/** The count of claims that need attention, from a verdict-count map. */
export function attentionCount(counts: Partial<Record<Verdict, number>>): number {
  return Object.entries(counts).reduce((sum, [verdict, n]) => (verdict === "supported" ? sum : sum + (n ?? 0)), 0);
}

/** Verdicts in the order the summary lists them: the serious ones first, Supported last. */
export const SUMMARY_ORDER: readonly Verdict[] = [
  "contradicted",
  "reference_not_found",
  "not_in_sources",
  "partial",
  "no_citation_given",
  "cant_tell",
  "cant_check",
  "supported",
];
