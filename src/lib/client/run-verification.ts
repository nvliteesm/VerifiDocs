// Drives one check from the browser, calling the API the way docs/architecture.md describes:
//   create the run -> extract each unit of the draft (3 at once) -> read the claims
//   -> check every claim with up to 5 in flight -> read the final results.
// It reports what happens as events (see verifier-state.ts) and never touches the screen itself. The API is
// injected, so it is tested with a fake. Every step is safe to repeat, so an interrupted check can be resumed.
import { ApiClientError } from "./api";
import { runPool } from "./pool";
import type { Api } from "./api";
import type { VerifyInput } from "./types";
import type { VerifyEvent } from "./verifier-state";

export const CHECK_CONCURRENCY = 5;
export const EXTRACT_CONCURRENCY = 3;
/** The server gives up after 3 attempts on its own; this only guards against a loop that never ends. */
const MAX_CHECK_ROUNDS = 6;

export interface VerifyDeps {
  api: Pick<Api, "createRun" | "extract" | "getRun" | "check">;
  sleep?: (ms: number) => Promise<void>;
}

export type Emit = (event: VerifyEvent) => void;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A message that is safe to show: the API client's own, or a generic one. Never raw error text. */
export function messageOf(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";
}

async function checkClaim(deps: VerifyDeps, claimId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  for (let round = 1; round <= MAX_CHECK_ROUNDS; round += 1) {
    if (signal.aborted) return;
    const reply = await deps.api.check(claimId);
    if (reply.outcome === "done") {
      emit({ type: "claim", verdict: reply.verdict });
      return;
    }
    await sleep(Math.min(1_000 * reply.attempt, 4_000));
  }
  throw new ApiClientError(0, "gave_up", "This claim could not be checked right now.");
}

/** Reads the run, then checks every claim that has no verdict yet. */
async function checkRemaining(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const run = await deps.api.getRun(runId);
  emit({ type: "loaded", run });
  if (signal.aborted) return;

  const pending = run.claims.filter((claim) => claim.verdict === null);
  if (run.run.status === "completed" || pending.length === 0) {
    emit({ type: "phase", phase: "done", message: run.claims.length === 0 ? "No checkable claims were found." : "Done." });
    return;
  }

  emit({ type: "phase", phase: "checking", message: "Checking each claim against your sources..." });
  await runPool(
    pending,
    CHECK_CONCURRENCY,
    (claim) => checkClaim(deps, claim.id, emit, signal),
    { signal, onError: (error, claim) => emit({ type: "claimError", id: claim.id, message: messageOf(error) }) },
  );
  if (signal.aborted) return;

  emit({ type: "loaded", run: await deps.api.getRun(runId) });
  emit({ type: "phase", phase: "done", message: "Done." });
}

/** Extracts every unit (the server skips any already done). Returns false, after reporting it, if one failed. */
async function extractAll(deps: VerifyDeps, runId: string, unitCount: number, emit: Emit, signal: AbortSignal): Promise<boolean> {
  emit({ type: "phase", phase: "extracting", message: "Finding the claims in your draft..." });
  let extracted = 0;
  const failures: string[] = [];
  await runPool(
    Array.from({ length: unitCount }, (_, unit) => unit),
    EXTRACT_CONCURRENCY,
    async (unit) => {
      await deps.api.extract(runId, unit);
      extracted += 1;
      emit({ type: "extracted", unitsExtracted: extracted });
    },
    { signal, onError: (error) => failures.push(messageOf(error)) },
  );
  if (signal.aborted) return false;
  if (failures.length > 0) {
    emit({ type: "failed", message: failures[0]! });
    return false;
  }
  return true;
}

/** A new check: create the run, extract the claims, check them. Failures are reported as a `failed` event. */
export async function runVerification(deps: VerifyDeps, input: VerifyInput, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    emit({ type: "phase", phase: "starting", message: "Reading your draft..." });
    const created = await deps.api.createRun(input);
    emit({ type: "run", runId: created.runId, unitCount: created.unitCount });
    if (signal.aborted) return;
    if (!(await extractAll(deps, created.runId, created.unitCount, emit, signal))) return;
    await checkRemaining(deps, created.runId, emit, signal);
  } catch (error) {
    if (!signal.aborted) emit({ type: "failed", message: messageOf(error) });
  }
}

/**
 * Picks up a check that was interrupted (a closed tab, a reload): extraction of any unit already done is skipped
 * by the server, and only claims without a verdict are checked.
 */
export async function resumeVerification(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    emit({ type: "phase", phase: "starting", message: "Reopening your check..." });
    const run = await deps.api.getRun(runId);
    emit({ type: "loaded", run });
    if (signal.aborted) return;
    if (run.run.status === "extracting" && !(await extractAll(deps, runId, run.run.unitCount, emit, signal))) return;
    await checkRemaining(deps, runId, emit, signal);
  } catch (error) {
    if (!signal.aborted) emit({ type: "failed", message: messageOf(error) });
  }
}

/** Checks one claim again, after its check failed in the browser. */
export async function retryClaim(deps: VerifyDeps, runId: string, claimId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  emit({ type: "claimRetry", id: claimId });
  try {
    await checkClaim(deps, claimId, emit, signal);
    emit({ type: "loaded", run: await deps.api.getRun(runId) });
  } catch (error) {
    if (!signal.aborted) emit({ type: "claimError", id: claimId, message: messageOf(error) });
  }
}
