// The shapes the browser exchanges with the API (docs/architecture.md, "API as built").
// Types only: this file has no runtime code, so it is safe to import from components.
import type { Verdict } from "../pipeline/types";

export type { Verdict };

export type RunStatus = "extracting" | "checking" | "completed" | "failed";

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  unitCount: number;
  referenceCount: number;
}

export interface ExtractResponse {
  unit: number;
  alreadyExtracted: boolean;
  claimsAdded: number;
  status: RunStatus;
  unitCount: number;
  unitsExtracted: number;
  claimCount: number;
  /** True when the AI could not read this part (or half of it). */
  failed?: boolean;
}

export interface ClaimView {
  id: string;
  position: number;
  text: string;
  citation: string | null;
  /** The sentence has no citation of its own; `citation` is the one later in its paragraph. */
  citationInherited: boolean;
  /** The heading the claim sits under, or null before the first heading. */
  section: string | null;
  /** "must": a reader would expect a source. "should": a general statement a source would strengthen. */
  need: "must" | "should";
  /** True once Find a source has run for this claim (even when it found nothing). */
  sourcesSearched?: boolean;
  /** Papers Find a source kept, best first. Not read yet: they never count as support. */
  sources?: FoundSourceView[];
  status: "pending" | "checking" | "done";
  verdict: Verdict | null;
  quote: string | null;
  page: number | null;
  reason: string | null;
  exitStage: number | null;
  fixSuggestion: string | null;
}

/** A paper Find a source found for an uncited claim (docs/source-discovery.md). */
export interface FoundSourceView {
  rank: number;
  openalexId: string;
  doi: string | null;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  openAccessPdf: string | null;
  /** One sentence from the abstract, verified to be in it. */
  sentence: string;
  relevance: "direct" | "related";
}

export interface FailedPart {
  unit: number;
  section: string | null;
}

export interface ReferenceView {
  position: number;
  text: string;
  resolution: "pending" | "found" | "not_found";
  resolvedTitle: string | null;
  yearMismatch: boolean;
}

export interface RunResponse {
  run: {
    id: string;
    status: RunStatus;
    unitCount: number;
    unitsExtracted: number;
    claimCount: number;
    createdAt: string;
    completedAt: string | null;
  };
  progress: { checked: number; total: number };
  counts: Partial<Record<Verdict, number>>;
  /** Claim ids that need attention, most serious first. */
  fixList: string[];
  /** Parts of the draft the AI could not read (wholly or half), named by the heading they start under. */
  failedParts: FailedPart[];
  claims: ClaimView[];
  references: ReferenceView[];
}

export type SourceStatus = "ingesting" | "ready" | "no_text" | "failed";

export interface SourceView {
  id: string;
  filename: string;
  status: SourceStatus;
  pageCount: number | null;
  pagesIngested: number;
  createdAt: string;
}

/** What reading a Google Docs link or a PDF draft gives back: the text to show in the draft box, never saved. */
export interface ImportResponse {
  text: string;
  source: "link" | "pdf";
  warnings: ("footnotes" | "tables")[];
  truncated: boolean;
  /** How many references the document ends with (0 for none), or null when it was too long to tell. */
  referenceCount: number | null;
}

/** How the draft panel brings a draft in without pasting it. */
export interface Importer {
  link(url: string): Promise<ImportResponse>;
  pdf(file: File): Promise<ImportResponse>;
}

export interface UploadResponse {
  documentId: string;
  status: "ingesting" | "no_text";
  pageCount: number;
}

export interface IngestResponse {
  documentId: string;
  status: SourceStatus;
  pagesIngested: number;
  pageCount: number;
  done: boolean;
}

export interface CheckedVerdict {
  claimId: string;
  verdict: Verdict;
  quote: string | null;
  page: number | null;
  reason: string;
  exitStage: number;
  fixSuggestion: string | null;
}

export type CheckResponse =
  | { outcome: "done"; runCompleted: boolean; verdict: CheckedVerdict }
  | { outcome: "retry"; reason: string; attempt: number };

/** What the student typed or chose for a check. */
export interface VerifyInput {
  draft: { kind: "paste"; text: string } | { kind: "docx"; file: File };
  /** Optional separate reference list. Empty means: use the one inside the draft, if any. */
  references: string;
  /**
   * What the draft was read from, when it was not pasted ("Google Doc", a file name), for the line that says what is
   * being checked. Kept in memory only, like the draft itself.
   */
  label?: string;
}

/** Events a student's browser may report (the server logs all other events itself). */
export type ClientEventName =
  | "evidence_opened"
  | "verdict_flagged_wrong"
  | "fix_accepted"
  | "recheck_started"
  | "report_exported"
  | "would_pay_answered"
  | "feature_interest_answered";
