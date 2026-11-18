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
}

export interface ClaimView {
  id: string;
  position: number;
  text: string;
  citation: string | null;
  status: "pending" | "checking" | "done";
  verdict: Verdict | null;
  quote: string | null;
  page: number | null;
  reason: string | null;
  exitStage: number | null;
  fixSuggestion: string | null;
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
