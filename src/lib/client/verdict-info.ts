// How each of the eight verdicts is shown to a student. The wording follows docs/verdicts.md. A verdict is never
// shown by colour alone: every one has a text label and a symbol as well.
import type { Verdict } from "./types";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export interface VerdictInfo {
  label: string;
  tone: Tone;
  /** A short mark shown beside the label. Decorative: the label carries the meaning. */
  symbol: string;
  /** One plain sentence on what this verdict means. */
  meaning: string;
  /** What the student can do about it. Empty for Supported. */
  advice: string;
}

export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  supported: {
    label: "Supported",
    tone: "good",
    symbol: "✓",
    meaning: "Your source states this, including any condition that matters.",
    advice: "",
  },
  partial: {
    label: "Partly supported",
    tone: "warn",
    symbol: "≈",
    meaning: "Part of this is in your source, but part is wrong, overstated, or leaves out a condition.",
    advice: "Rewrite the sentence so it says only what the source says.",
  },
  contradicted: {
    label: "Contradicted",
    tone: "bad",
    symbol: "✕",
    meaning: "Your source says the opposite, or gives a different value.",
    advice: "Correct the sentence to match the source, or cite a different source.",
  },
  not_in_sources: {
    label: "Not in your sources",
    tone: "warn",
    symbol: "?",
    meaning: "None of the passages checked from your source say this.",
    advice: "Find where the source says it, cite a source that does, or remove the claim.",
  },
  cant_tell: {
    label: "Can't tell",
    tone: "muted",
    symbol: "–",
    meaning: "The source is unclear, or the evidence could not be confirmed, so the tool did not guess.",
    advice: "Check this one yourself against the source.",
  },
  reference_not_found: {
    label: "Reference not found",
    tone: "bad",
    symbol: "!",
    meaning: "This citation is not in your reference list, or no record of it was found online and none of your uploaded PDFs matches it. It may be mistyped, or it may be a report that is not published online.",
    advice: "Check the citation is spelled correctly. If it is a report or thesis that is not online, upload its PDF.",
  },
  cant_check: {
    label: "Can't check yet",
    tone: "info",
    symbol: "↑",
    meaning: "The reference exists, but no readable PDF of it was uploaded.",
    advice: "Upload the PDF of this source (a text PDF, not a scan) and check again.",
  },
  no_citation_given: {
    label: "No citation",
    tone: "info",
    symbol: "○",
    meaning: "This looks like a factual claim but has no citation.",
    advice: "Add a citation, or take the claim out.",
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
