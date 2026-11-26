// Stages 2 to 4 for one claim, before retrieval and the judge: does the claim have a citation, does the
// citation point at an entry in the reference list, does that reference exist (Crossref, OpenAlex), and
// is there an uploaded source to check against?
//
// Every early exit is a real verdict with a reason (docs/verdicts.md). Rules:
// - No citation                          -> No citation given (stage 2).
// - A citation that cannot be read, or that matches no entry in the reference list, or an entry that
//   neither service knows, and no uploaded PDF matches it -> Reference not found (stage 3). If an uploaded PDF
//   does match (a report or thesis that is not online), the claim is checked against that PDF instead.
//   If a claim cites several references, ANY one that is not found makes the claim Reference not found.
// - A lookup that failed (not "unknown") -> retry, never a verdict by itself.
// - References exist but no usable PDF   -> Can't check (stage 4).
//   If some cited references have a usable PDF, the claim is checked against those.
import { NO_REFERENCE_LIST, NOT_IN_REFERENCE_LIST } from "../reasons";
import { documentCitationKind, matchEntryIndex, normalizeForMatch, parseCitationMarkers, type CitationMarker, type DocumentCitationKind } from "./citations";
import type { SourceLookup } from "./find-source";
import { classifyReference, indexedOnline } from "./reference-type";
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
  /**
   * For an entry that neither service knows (a report, a thesis, a web page): is there an uploaded PDF for it?
   * When one matches, the claim is checked against it instead of ending as Reference not found.
   */
  findUploaded?(entry: PreludeEntry): Promise<SourceLookup>;
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
  // Surnames are stored lowercased for matching; show them capitalised so the student recognises their own citation.
  if (marker.kind === "author-year") return `${marker.surnames.join(" & ").replace(/(^|[\s&-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase())} ${marker.year}`;
  return marker.raw;
}

/** The part of a citation like "(Smith, 2020; SNI 03-0349-1989)" that a marker came from, so a law is not blamed on a paper. */
function partOf(marker: CitationMarker): string {
  if (marker.kind !== "author-year") return marker.raw;
  const first = marker.surnames[0] ?? "";
  return marker.raw.split(";").find((part) => normalizeForMatch(part).includes(first)) ?? marker.raw;
}

/**
 * A law, a standard or an institution cannot be looked up online, so the claim cannot be checked: said plainly, not
 * "not found". The English wording is the same as the screen's (messages.ts, reason.*Citation), so it can be translated.
 */
function documentExit(kind: DocumentCitationKind, citation: string): { outcome: "exit"; exit: StageExit } {
  const named = `"${snippet(citation.replace(/^\s*\(|\)\s*$/g, ""))}"`;
  const reason =
    kind === "law"
      ? `${named} is a law or regulation. VerifiDocs does not look these up, so check the wording against the official text.`
      : kind === "standard"
        ? `${named} is a standard. VerifiDocs does not look these up, so check the number and the wording against the official standard.`
        : `${named} is an institution, not a paper. VerifiDocs does not look these up, so check the figure against the original report.`;
  return { outcome: "exit", exit: { verdict: "cant_check", exitStage: 3, reason } };
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET)}...` : t;
}

/**
 * The part of the prelude that needs no network: no citation, a citation that cannot be read, or one that is not in
 * the reference list each end the claim right here. Otherwise the entries the citation names are returned, for the
 * lookups that follow. The scan uses this on its own to give those early verdicts to every claim at once.
 */
export function matchCitation(
  rawCitation: string | null,
  entries: PreludeEntry[],
): { outcome: "exit"; exit: StageExit } | { outcome: "matched"; matched: PreludeEntry[] } {
  const citation = rawCitation?.trim() ?? "";
  if (citation.length === 0) {
    return { outcome: "exit", exit: { verdict: "no_citation_given", exitStage: 2, reason: "The claim has no citation." } };
  }

  const markers = parseCitationMarkers(citation);
  const raws = entries.map((entry) => entry.raw);
  const matched: PreludeEntry[] = [];

  for (const marker of markers) {
    if (marker.kind === "unreadable") {
      const kind = documentCitationKind(marker.raw);
      if (kind) return documentExit(kind, marker.raw);
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
      const kind = documentCitationKind(partOf(marker));
      if (kind) return documentExit(kind, partOf(marker));
      return {
        outcome: "exit",
        exit: {
          verdict: "reference_not_found",
          exitStage: 3,
          reason:
            entries.length === 0
              ? `"${label(marker)}" cannot be matched because ${NO_REFERENCE_LIST}. Paste your reference list and check again.`
              : `"${label(marker)}" ${NOT_IN_REFERENCE_LIST}.`,
        },
      };
    }
    const entry = entries[index]!;
    if (!matched.some((m) => m.position === entry.position)) matched.push(entry);
  }

  return { outcome: "matched", matched };
}

export async function runPrelude(
  claim: { citation: string | null },
  entries: PreludeEntry[],
  deps: PreludeDeps,
): Promise<PreludeResult> {
  const early = matchCitation(claim.citation, entries);
  if (early.outcome === "exit") return early;
  const matched = early.matched;

  const references: { position: number; resolution: Found }[] = [];
  const lookups: SourceLookup[] = [];
  const errors: string[] = [];

  for (const entry of matched) {
    const resolution = await deps.resolve(entry);
    if (resolution.status === "not_found") {
      const uploaded = deps.findUploaded ? await deps.findUploaded(entry) : ({ kind: "none" } as SourceLookup);
      if (uploaded.kind !== "none") {
        // Not online, but the student uploaded a PDF that matches: the PDF is the evidence.
        lookups.push(uploaded);
        continue;
      }
      // Only a journal-style entry is worth calling "not found": journals are what Crossref and OpenAlex index, and AI
      // tools invent them. A thesis, conference paper, book, law, standard or government report is often just not online
      // (Indonesian ones very often), so it is "could not be retrieved", never a hint that it may not exist.
      if (indexedOnline(classifyReference(entry.raw))) {
        return {
          outcome: "exit",
          exit: {
            verdict: "reference_not_found",
            exitStage: 3,
            reason: `Reference ${entry.position} ("${snippet(entry.raw)}") was not found in Crossref or OpenAlex, and none of your uploaded PDFs matches it. Some journals are not indexed online, so check that it exists and upload its PDF if you have it.`,
          },
        };
      }
      return {
        outcome: "exit",
        exit: {
          verdict: "cant_check",
          exitStage: 3,
          reason: `Reference ${entry.position} ("${snippet(entry.raw)}") could not be retrieved automatically. It may not be online. Upload its PDF to check this claim.`,
        },
      };
    }
    if (resolution.status === "error") {
      // The online lookup failed (a rate limit, a timeout). If the student uploaded a PDF that matches the entry,
      // the PDF is the evidence and the lookup is not needed, so do not fail the claim over it.
      const uploaded = deps.findUploaded ? await deps.findUploaded(entry) : ({ kind: "none" } as SourceLookup);
      if (uploaded.kind !== "none") {
        lookups.push(uploaded);
        continue;
      }
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
