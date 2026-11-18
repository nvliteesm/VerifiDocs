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
}

export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  supported: { tone: "good", symbol: "✓" },
  partial: { tone: "warn", symbol: "≈" },
  contradicted: { tone: "bad", symbol: "✕" },
  not_in_sources: { tone: "warn", symbol: "?" },
  cant_tell: { tone: "muted", symbol: "–" },
  reference_not_found: { tone: "bad", symbol: "!" },
  cant_check: { tone: "info", symbol: "↑" },
  no_citation_given: { tone: "info", symbol: "○" },
};

/** The short name of a verdict, in the screen's language. */
export function verdictLabel(t: Translate, verdict: Verdict): string {
  return t(`verdict.${verdict}.label` as MessageKey);
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
