// The ranked fix list (PRD v0.3, v1 feature): claims that need attention, most serious first.
// Order is from docs/verdicts.md (proposed there, to be confirmed on the eval set). Supported claims are
// not shown, and a claim with no verdict yet has nothing to fix.
import type { Verdict } from "./pipeline/types";

export const FIX_LIST_ORDER: readonly Verdict[] = [
  "contradicted",
  "reference_not_found",
  "not_in_sources",
  "partial",
  "no_citation_given",
  "cant_tell",
  "cant_check",
];

const RANK = new Map<Verdict, number>(FIX_LIST_ORDER.map((verdict, index) => [verdict, index]));

/** Claims with a non-Supported verdict, ordered by severity and then by position in the draft. */
export function rankFixList<T extends { verdict: Verdict | null; position: number }>(claims: T[]): T[] {
  return claims
    .filter((claim): claim is T & { verdict: Verdict } => claim.verdict !== null && RANK.has(claim.verdict))
    .sort((a, b) => RANK.get(a.verdict)! - RANK.get(b.verdict)! || a.position - b.position);
}
