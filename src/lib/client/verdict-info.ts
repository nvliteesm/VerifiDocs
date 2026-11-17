// How each of the eight verdicts is shown to a student. The wording follows docs/verdicts.md. A verdict is never
// shown by colour alone: every one has a text label and a symbol as well.
// Text is kept short on purpose: the label says what happened, the reason (written per claim) says why, and the
// advice says what to do. There is no separate "meaning" line, because it only repeated the label.
import type { Verdict } from "./types";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export interface VerdictInfo {
  label: string;
  tone: Tone;
  /** A short mark shown beside the label. Decorative: the label carries the meaning. */
  symbol: string;
  /** What the student can do about it. Empty for Supported. */
  advice: string;
}

export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  supported: {
    label: "Supported",
    tone: "good",
    symbol: "✓",
    advice: "",
  },
  partial: {
    label: "Partly supported",
    tone: "warn",
    symbol: "≈",
    advice: "Rewrite it to say only what the source says.",
  },
  contradicted: {
    label: "Contradicted",
    tone: "bad",
    symbol: "✕",
    advice: "Change the sentence to match the source, or cite another source.",
  },
  not_in_sources: {
    label: "Not in your sources",
    tone: "warn",
    symbol: "?",
    advice: "Find where a source says it, or remove the claim.",
  },
  cant_tell: {
    label: "Can't tell",
    tone: "muted",
    symbol: "–",
    advice: "Check this one yourself in the source.",
  },
  reference_not_found: {
    label: "Reference not found",
    tone: "bad",
    symbol: "!",
    advice: "Check the spelling. If it is not online, upload its PDF.",
  },
  cant_check: {
    label: "Can't check yet",
    tone: "info",
    symbol: "↑",
    advice: "Upload its PDF (text, not a scan) and check again.",
  },
  no_citation_given: {
    label: "No citation",
    tone: "info",
    symbol: "○",
    advice: "Add a citation, or remove the claim.",
  },
};

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
