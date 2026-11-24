// A cited reference whose year is off: the student's list says 2015, the paper came out in 2013.
//
// The reference lookup (stage 3) already records this per reference entry (year_mismatch, resolved_year). This
// links a claim to its entries the same way the check does (matchCitation), so a card can say which year to fix.
// It never changes a verdict: the claim can still be Supported, and the year is a separate thing to fix.
import { matchCitation, type PreludeEntry } from "./prelude";
import { firstYear } from "./resolve-reference";

export interface YearEntry extends PreludeEntry {
  yearMismatch: boolean;
  /** The year of the record the lookup matched, when it found one. */
  resolvedYear: number | null;
}

export interface YearNote {
  /** 1-based position in the reference list. */
  position: number;
  /** The year written in the student's reference list. */
  cited: number;
  /** The year the matched paper came out. */
  published: number;
}

export function yearNotesFor(citation: string | null, entries: YearEntry[]): YearNote[] {
  if (!citation || !entries.some((entry) => entry.yearMismatch)) return [];
  const result = matchCitation(citation, entries);
  if (result.outcome !== "matched") return [];

  const byPosition = new Map(entries.map((entry) => [entry.position, entry]));
  const notes: YearNote[] = [];
  for (const matched of result.matched) {
    const entry = byPosition.get(matched.position);
    if (!entry?.yearMismatch || entry.resolvedYear === null) continue;
    const cited = firstYear(entry.raw);
    if (cited !== null && cited !== entry.resolvedYear) notes.push({ position: entry.position, cited, published: entry.resolvedYear });
  }
  return notes;
}
