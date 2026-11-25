// The UI state of one check, as a pure reducer. The orchestrator (run-verification.ts) emits events and this
// turns them into state, so the screen is always a function of what actually happened.
// Verdict counts and the ranked fix list are DERIVED from the claims, never stored separately, so they cannot
// disagree with the claim list on screen.
import { rankFixList } from "../fix-list";
import type { CheckedVerdict, ClaimView, FailedPart, FoundSourceView, ReferenceView, RunResponse, RunStatus, Verdict, WebSourceView } from "./types";

/**
 * "extracting" is the scan (reading the draft for claims). "scanned" is where it stops: the claims that need no
 * lookup already have a verdict, and the cited ones wait for the student to start the check.
 */
export type Phase = "idle" | "starting" | "extracting" | "scanned" | "checking" | "done" | "error";

export interface VerifierState {
  phase: Phase;
  message: string;
  runId: string | null;
  runStatus: RunStatus | null;
  unitCount: number;
  unitsExtracted: number;
  claims: ClaimView[];
  references: ReferenceView[];
  counts: Partial<Record<Verdict, number>>;
  /** Claim ids that need attention, most serious first. */
  fixList: string[];
  /** Claims whose check failed in the browser (not a verdict). The student can retry them. */
  claimErrors: Record<string, string>;
  /** Parts of the draft the AI could not read; the student can read each one again. */
  failedParts: FailedPart[];
  /** True when the server has web search set up, so a No-paper-found card may offer "Search the web". */
  webSearch: boolean;
  error: string | null;
  /** True when the student pressed Stop. The check then ends as "done" with some claims left unchecked. */
  stopped: boolean;
}

export const initialState: VerifierState = {
  phase: "idle",
  message: "",
  runId: null,
  runStatus: null,
  unitCount: 0,
  unitsExtracted: 0,
  claims: [],
  references: [],
  counts: {},
  fixList: [],
  claimErrors: {},
  failedParts: [],
  webSearch: false,
  error: null,
  stopped: false,
};

export type VerifyEvent =
  | { type: "reset" }
  | { type: "phase"; phase: Phase; message: string }
  | { type: "run"; runId: string; unitCount: number }
  | { type: "extracted"; unitsExtracted: number }
  | { type: "loaded"; run: RunResponse }
  | { type: "claim"; verdict: CheckedVerdict }
  | { type: "claimError"; id: string; message: string }
  | { type: "claimRetry"; id: string }
  | { type: "sources"; claimId: string; sources: FoundSourceView[] }
  | { type: "webSources"; claimId: string; sources: WebSourceView[] }
  | { type: "failed"; message: string }
  | { type: "stopped" };

export function countVerdicts(claims: ClaimView[]): Partial<Record<Verdict, number>> {
  const counts: Partial<Record<Verdict, number>> = {};
  for (const claim of claims) if (claim.verdict) counts[claim.verdict] = (counts[claim.verdict] ?? 0) + 1;
  return counts;
}

function withClaims(state: VerifierState, claims: ClaimView[]): VerifierState {
  return {
    ...state,
    claims,
    counts: countVerdicts(claims),
    fixList: rankFixList(claims).map((claim) => claim.id),
  };
}

function withoutError(errors: Record<string, string>, id: string): Record<string, string> {
  const rest = { ...errors };
  delete rest[id];
  return rest;
}

export function reduce(state: VerifierState, event: VerifyEvent): VerifierState {
  switch (event.type) {
    case "reset":
      return initialState;

    case "phase":
      return { ...state, phase: event.phase, message: event.message, error: null };

    case "run":
      return { ...initialState, phase: state.phase, message: state.message, runId: event.runId, unitCount: event.unitCount };

    case "extracted":
      return { ...state, unitsExtracted: event.unitsExtracted };

    case "loaded": {
      const { run } = event;
      return {
        ...withClaims(state, run.claims),
        runId: run.run.id,
        runStatus: run.run.status,
        unitCount: run.run.unitCount,
        unitsExtracted: run.run.unitsExtracted,
        references: run.references,
        failedParts: run.failedParts ?? [],
        webSearch: run.webSearch ?? false,
      };
    }

    case "claim": {
      const verdict = event.verdict;
      const claims = state.claims.map((claim) =>
        claim.id === verdict.claimId
          ? {
              ...claim,
              status: "done" as const,
              verdict: verdict.verdict,
              quote: verdict.quote,
              page: verdict.page,
              reason: verdict.reason,
              exitStage: verdict.exitStage,
              fixSuggestion: verdict.fixSuggestion,
              quoteGloss: verdict.quoteGloss ?? null,
              yearNotes: verdict.yearNotes ?? [],
            }
          : claim,
      );
      return { ...withClaims(state, claims), claimErrors: withoutError(state.claimErrors, verdict.claimId) };
    }

    case "claimError":
      return { ...state, claimErrors: { ...state.claimErrors, [event.id]: event.message } };

    case "sources":
      return {
        ...state,
        claims: state.claims.map((claim) =>
          claim.id === event.claimId ? { ...claim, sourcesSearched: true, sources: event.sources } : claim,
        ),
      };

    case "webSources":
      return {
        ...state,
        claims: state.claims.map((claim) =>
          claim.id === event.claimId ? { ...claim, webSearched: true, webSources: event.sources } : claim,
        ),
      };

    case "claimRetry":
      return { ...state, claimErrors: withoutError(state.claimErrors, event.id) };

    case "failed":
      return { ...state, phase: "error", error: event.message, message: "" };

    case "stopped":
      // Only a check that is still running can be stopped. A late Stop after the end changes nothing.
      if (state.phase === "idle" || state.phase === "scanned" || state.phase === "done" || state.phase === "error") return state;
      return { ...state, phase: "done", stopped: true, message: "", error: null };
  }
}

/** How many claims have a verdict, and how many there are. */
export function checkedProgress(state: VerifierState): { checked: number; total: number } {
  return { checked: state.claims.filter((claim) => claim.verdict !== null).length, total: state.claims.length };
}
