// Stages 2 to 4 for one claim, before retrieval and the judge: does the claim have a citation, does the
// citation point at an entry in the reference list, does that reference exist (Crossref, OpenAlex), and
// is there an uploaded source to check against?
//
// Every early exit is a real verdict with a reason (docs/verdicts.md). Rules:
// - No citation                          -> No citation given (stage 2).
// - A citation that cannot be read, or that matches no entry in the reference list, or an entry that
//   neither service knows              -> Reference not found (stage 3).
//   If a claim cites several references, ANY one that is not found makes the claim Reference not found.
// - A lookup that failed (not "unknown") -> retry, never a verdict by itself.
// - References exist but no usable PDF   -> Can't check (stage 4).
//   If some cited references have a usable PDF, the claim is checked against those.
import { matchEntryIndex, parseCitationMarkers, type CitationMarker } from "./citations";
import type { SourceLookup } from "./find-source";
import type { ReferenceResolution } from "./resolve-reference";
import type { StageExit } from "./types";

export interface PreludeEntry {
  /** The reference_entries row, so a lookup can be cached against it. */
  id: string;
  /** 1-based position in the reference list. */
  position: number;
  raw: string;
  /** A document the student linked to this entry, if any. */
  documentId: string | null;
}

type Found = Extract<ReferenceResolution, { status: "found" }>;

export interface PreludeDeps {
  resolve(entry: PreludeEntry): Promise<ReferenceResolution>;
  findSource(entry: PreludeEntry, resolution: Found): Promise<SourceLookup>;
}

export type PreludeResult =
  | { outcome: "exit"; exit: StageExit }
  /** A lookup failed. Retry the claim; after the bounded retries it becomes Can't tell with this reason. */
  | { outcome: "retry"; reason: string }
  | {
      outcome: "ready";
      /** Documents to search for passages (stage 6). */
      documentIds: string[];
      references: { position: number; resolution: Found }[];
    };

const SNIPPET = 70;

function label(marker: CitationMarker): string {
  if (marker.kind === "numeric") return `[${marker.number}]`;
  if (marker.kind === "author-year") return `${marker.surnames.join(" & ")} ${marker.year}`;
  return marker.raw;
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET)}...` : t;
}

export async function runPrelude(
  claim: { citation: string | null },
  entries: PreludeEntry[],
  deps: PreludeDeps,
): Promise<PreludeResult> {
  const citation = claim.citation?.trim() ?? "";
  if (citation.length === 0) {
    return { outcome: "exit", exit: { verdict: "no_citation_given", exitStage: 2, reason: "The claim has no citation." } };
  }

  const markers = parseCitationMarkers(citation);
  const raws = entries.map((entry) => entry.raw);
  const matched: PreludeEntry[] = [];

  for (const marker of markers) {
    if (marker.kind === "unreadable") {
      return {
        outcome: "exit",
        exit: {
          verdict: "reference_not_found",
          exitStage: 3,
          reason: `The citation "${snippet(marker.raw)}" could not be read as an author and year or a reference number.`,
        },
      };
    }
    const index = matchEntryIndex(marker, raws);
    if (index < 0) {
      return {
        outcome: "exit",
        exit: {
          verdict: "reference_not_found",
          exitStage: 3,
          reason: `"${label(marker)}" is not in your reference list.`,
        },
      };
    }
    const entry = entries[index]!;
    if (!matched.some((m) => m.position === entry.position)) matched.push(entry);
  }

  const references: { position: number; resolution: Found }[] = [];
  const lookups: SourceLookup[] = [];
  const errors: string[] = [];

  for (const entry of matched) {
    const resolution = await deps.resolve(entry);
    if (resolution.status === "not_found") {
      return {
        outcome: "exit",
        exit: {
          verdict: "reference_not_found",
          exitStage: 3,
          reason: `Reference ${entry.position} ("${snippet(entry.raw)}") was not found in Crossref or OpenAlex.`,
        },
      };
    }
    if (resolution.status === "error") {
      errors.push(resolution.reason);
      continue;
    }
    references.push({ position: entry.position, resolution });
    lookups.push(await deps.findSource(entry, resolution));
  }

  if (errors.length > 0) return { outcome: "retry", reason: [...new Set(errors)].join("; ") };

  const documentIds = [
    ...new Set(lookups.flatMap((lookup) => (lookup.kind === "found" ? [lookup.documentId] : []))),
  ];
  if (documentIds.length > 0) return { outcome: "ready", documentIds, references };

  if (lookups.some((lookup) => lookup.kind === "no_text")) {
    return {
      outcome: "exit",
      exit: {
        verdict: "cant_check",
        exitStage: 4,
        reason: "The uploaded PDF for this reference has no readable text (it may be a scan). Upload a text version.",
      },
    };
  }
  return {
    outcome: "exit",
    exit: {
      verdict: "cant_check",
      exitStage: 4,
      reason: "The reference exists, but no uploaded source matches it. Upload the PDF to check this claim.",
    },
  };
}
