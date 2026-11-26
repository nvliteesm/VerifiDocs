// How each of the eight verdicts is shown to a student. The wording follows docs/verdicts.md. A verdict is never
// shown by colour alone: every one has a text label and a symbol as well.
// Text is kept short on purpose: the label says what happened, the reason (written per claim) says why, and the
// advice says what to do. The label and advice live in src/lib/i18n/messages.ts (English and Bahasa Indonesia).
import type { MessageKey, Translate } from "../i18n";
import { isOptional } from "../fix-list";
import type { Verdict } from "./types";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export interface VerdictInfo {
  tone: Tone;
  /** A short mark shown beside the label. Decorative: the label carries the meaning. */
  symbol: string;
  /** The icon as an SVG path (16x16, stroked). Decorative: the label carries the meaning. Each verdict has its own shape. */
  icon: string;
  /** A second path drawn filled, for the one icon that is half solid (Partly supported). */
  fill?: string;
}

const RING = "M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z";

// One shape per verdict (the Claude Design reference, 25 Nov 2026): a ring with a tick, a half-filled ring, a ring with
// "not equal", a magnifier with a minus, a broken link, a page with an up arrow, a ring with a wave, brackets with a plus.
export const VERDICT_INFO: Record<Verdict, VerdictInfo> = {
  supported: { tone: "good", symbol: "✓", icon: `${RING} M5 8.2l2 2 4-4.4` },
  partial: { tone: "warn", symbol: "≈", icon: RING, fill: "M8 1.5a6.5 6.5 0 0 1 0 13z" },
  contradicted: { tone: "bad", symbol: "✕", icon: `${RING} M5 6.6h6 M5 9.4h6 M9.6 4.4l-3.2 7.2` },
  not_in_sources: { tone: "warn", symbol: "?", icon: "M7 2.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 1 0 0-9.6z M10.6 10.6L14 14 M5 7h4" },
  cant_tell: { tone: "muted", symbol: "–", icon: `${RING} M4.8 8.6c1-1.4 2.2-1.4 3.2 0s2.2 1.4 3.2 0` },
  reference_not_found: { tone: "bad", symbol: "!", icon: "M6.6 9.4l-1.9 1.9a2.3 2.3 0 0 1-3.2-3.2l1.9-1.9 M9.4 6.6l1.9-1.9a2.3 2.3 0 0 1 3.2 3.2l-1.9 1.9 M5.5 1.8v2 M1.8 5.5h2 M10.5 14.2v-2 M14.2 10.5h-2" },
  cant_check: { tone: "info", symbol: "↑", icon: "M4 1.5h5l3 3v10H4z M8 12V7.6 M6.2 9.4L8 7.6l1.8 1.8" },
  no_citation_given: { tone: "info", symbol: "○", icon: "M5 3H3v10h2 M11 3h2v10h-2 M8 5.5v5 M5.5 8h5" },
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

/**
 * How well the claims could be checked, in buckets that never overlap, so the counts add up to the number of claims.
 * Source availability is kept apart from the verdict: a claim whose source has not been added is "awaiting", not wrong.
 *
 *   supported  a source says it
 *   findings   a source was read and the claim needs attention (partly supported, contradicted, not in the sources, unclear)
 *   citation   the citation itself needs fixing: not in the reference list, or a claim with no citation that needs one
 *   awaiting   no source could be read for it yet (not uploaded, not retrieved, a law or standard, or not checked yet)
 *   general    a general statement that a source would only strengthen (informational)
 *   checking   the check is running and this claim has no answer yet
 */
export interface Coverage {
  total: number;
  supported: number;
  findings: number;
  citation: number;
  awaiting: number;
  general: number;
  checking: number;
  /** Claims actually judged against a source (supported plus findings). */
  verified: number;
  /** Some claims could not be verified yet, because their sources are missing. */
  incomplete: boolean;
  /** Nothing at all could be verified, and the claims are waiting for sources. */
  none: boolean;
}

export function coverageOf(claims: readonly { verdict: Verdict | null; need?: "must" | "should" }[], running: boolean): Coverage {
  const out: Coverage = { total: claims.length, supported: 0, findings: 0, citation: 0, awaiting: 0, general: 0, checking: 0, verified: 0, incomplete: false, none: false };
  for (const claim of claims) {
    switch (claim.verdict) {
      case "supported":
        out.supported += 1;
        break;
      case "partial":
      case "contradicted":
      case "not_in_sources":
      case "cant_tell":
        out.findings += 1;
        break;
      case "reference_not_found":
        out.citation += 1;
        break;
      case "no_citation_given":
        if (isOptional(claim)) out.general += 1;
        else out.citation += 1;
        break;
      case "cant_check":
        out.awaiting += 1;
        break;
      default:
        if (running) out.checking += 1;
        else out.awaiting += 1;
    }
  }
  out.verified = out.supported + out.findings;
  out.incomplete = out.awaiting > 0;
  out.none = out.verified === 0 && out.awaiting > 0 && !running;
  return out;
}
