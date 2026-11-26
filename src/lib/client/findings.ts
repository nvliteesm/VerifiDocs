// Turns a long list of findings into something a student can start on: repeated findings grouped into one, the few that
// deserve attention first, and a severity for filtering. Pure, so the screen and the tests share it.
//
// A "finding" is something the student can act on: a claim a source contradicts or only partly backs, a claim the sources
// do not mention, a passage that could not be read clearly, a citation that is not in the reference list, or a claim
// that needs a citation and has none. A claim that only waits for a source file is not a finding: "Add missing sources"
// is its action, and the sources overview lists what is missing.
import { isOptional } from "../fix-list";
import { normalizeForMatch } from "../pipeline/citations";
import type { ClaimView, Verdict } from "./types";

export type Severity = "high" | "medium" | "low";

/** How much a verdict matters to the paper. Only a claim a source contradicts is a confirmed problem with the content. */
export function severityOf(verdict: Verdict): Severity {
  switch (verdict) {
    case "contradicted":
      return "high";
    case "partial":
    case "not_in_sources":
    case "reference_not_found":
    case "cant_tell":
      return "medium";
    default:
      return "low";
  }
}

const FINDING_VERDICTS: ReadonlySet<Verdict> = new Set(["contradicted", "partial", "not_in_sources", "cant_tell", "reference_not_found", "no_citation_given"]);

/** Verdicts whose claims share one cause when they share a citation: the same reference missing from the list, or the same source. */
const REPEATABLE: ReadonlySet<Verdict> = new Set(["reference_not_found", "cant_check"]);

export interface FindingGroup {
  /** Stable for the same finding. */
  key: string;
  verdict: Verdict;
  severity: Severity;
  /** The citation the repeated claims share, shown as the title; null for a single claim. */
  citation: string | null;
  /** Every affected claim, in draft order. One for a single finding. */
  claims: ClaimView[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 300, medium: 200, low: 100 };

function isFinding(claim: ClaimView, resolved: ReadonlySet<string>): boolean {
  return claim.verdict !== null && FINDING_VERDICTS.has(claim.verdict) && !resolved.has(claim.id) && !isOptional(claim);
}

/** The citation as the student wrote it, without its brackets. */
export function plainCitation(citation: string): string {
  return citation.replace(/^\s*[([]|[)\]]\s*$/g, "").trim();
}

/**
 * Findings as groups: claims that repeat one cause (the same unlisted reference cited in 15 places) become one group with
 * every place listed; everything else is a group of one. `claims` may include any verdict; only findings are returned.
 */
export function groupFindings(claims: readonly ClaimView[], resolved: ReadonlySet<string> = new Set()): FindingGroup[] {
  const ordered = [...claims].filter((claim) => isFinding(claim, resolved)).sort((a, b) => a.position - b.position);
  const byKey = new Map<string, FindingGroup>();
  const groups: FindingGroup[] = [];
  for (const claim of ordered) {
    const verdict = claim.verdict!;
    const shared = REPEATABLE.has(verdict) && claim.citation ? normalizeForMatch(claim.citation) : null;
    const key = shared ? `${verdict}|${shared}` : `claim|${claim.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.claims.push(claim);
      continue;
    }
    const group: FindingGroup = { key, verdict, severity: severityOf(verdict), citation: shared && claim.citation ? plainCitation(claim.citation) : null, claims: [claim] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

/**
 * How much a group deserves attention first. Severity leads. Then the number of places it appears (a citation missing in
 * 15 places matters more than one missing once), how sure the finding is (a source's own words, or a list check, are
 * sure; "could not tell" is not), and whether the student can do something about it right away.
 */
export function priorityOf(group: FindingGroup): number {
  const first = group.claims[0]!;
  const places = Math.min(group.claims.length, 15) * 4;
  const confidence =
    group.verdict === "cant_tell" ? -10 : group.verdict === "reference_not_found" ? 15 : group.verdict === "no_citation_given" ? 5 : first.quote ? 20 : 10;
  const actionable = (first.fixSuggestion ? 15 : 0) + (group.verdict === "reference_not_found" ? 10 : 0);
  return SEVERITY_WEIGHT[group.severity] + places + confidence + actionable;
}

/** The few findings worth looking at first, most deserving first (ties go to the earlier place in the draft). */
export function startHere(groups: readonly FindingGroup[], limit = 5): FindingGroup[] {
  return [...groups]
    .map((group, index) => ({ group, index, score: priorityOf(group) }))
    .sort((a, b) => b.score - a.score || a.group.claims[0]!.position - b.group.claims[0]!.position || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.group);
}

/** The sections of the draft that have claims, in the order they appear. */
export function sectionsOf(claims: readonly ClaimView[]): string[] {
  const seen: string[] = [];
  for (const claim of [...claims].sort((a, b) => a.position - b.position)) {
    if (claim.section && !seen.includes(claim.section)) seen.push(claim.section);
  }
  return seen;
}
