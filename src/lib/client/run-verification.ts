// Drives one check from the browser, calling the API the way docs/architecture.md describes:
//   create the run -> extract each unit of the draft (3 at once) -> read the claims
//   -> check every claim with up to 5 in flight -> read the final results.
// It reports what happens as events (see verifier-state.ts) and never touches the screen itself. The API is
// injected, so it is tested with a fake. Every step is safe to repeat, so an interrupted check can be resumed.
import { ApiClientError } from "./api";
import { runPool } from "./pool";
import type { Api } from "./api";
import type { ClaimView, VerifyInput } from "./types";
import type { VerifyEvent } from "./verifier-state";
import { MESSAGES, translatorFor, type Locale, type MessageKey, type Translate } from "../i18n";

const english = translatorFor("en");
/** One of the fixed progress lines, in the screen's language (English when none is given). */
const say = (deps: { t?: Translate }, key: MessageKey) => (deps.t ?? english)(key);

export const CHECK_CONCURRENCY = 5;
export const EXTRACT_CONCURRENCY = 3;
/**
 * The server never ends a claim over a passing failure (a timeout, a busy service), so the browser stops after this
 * many rounds and the card offers "Try again".
 */
const MAX_CHECK_ROUNDS = 6;

export interface VerifyDeps {
  api: Pick<Api, "createRun" | "extract" | "getRun" | "check">;
  sleep?: (ms: number) => Promise<void>;
  /** Turns a message key into the screen's language. Without it, messages are English. */
  t?: Translate;
  locale?: Locale;
}

export type Emit = (event: VerifyEvent) => void;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A message that is safe to show: the API client's own, or a generic one. Never raw error text. */
export function messageOf(error: unknown, t?: Translate, locale?: Locale): string {
  const translate = t ?? english;
  if (error instanceof ApiClientError) {
    // In English the API client's own message is used as it is: the server words it exactly, for example with the
    // number of minutes to wait. In another language it is looked up by its code, and the server's message is the
    // fallback for a code that has no translation.
    if (!t || locale === "en") return error.message;
    const key = `err.${error.code}` as MessageKey;
    return key in MESSAGES.en ? translate(key) : error.message;
  }
  return translate("err.generic");
}

async function checkClaim(deps: VerifyDeps, claimId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  if (!signal.aborted) emit({ type: "claimStart", id: claimId });
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

/** Splits claims into the first claim of each distinct citation, and the rest. A claim with no citation is "rest". */
export function oneClaimPerCitation(claims: readonly ClaimView[]): { first: ClaimView[]; rest: ClaimView[] } {
  const seen = new Set<string>();
  const first: ClaimView[] = [];
  const rest: ClaimView[] = [];
  for (const claim of claims) {
    const key = (claim.citation ?? "").trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      first.push(claim);
    } else {
      rest.push(claim);
    }
  }
  return { first, rest };
}

/** Reads the run, then checks every claim that has no verdict yet. */
async function checkRemaining(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const run = await deps.api.getRun(runId);
  emit({ type: "loaded", run });
  if (signal.aborted) return;

  const pending = run.claims.filter((claim) => claim.verdict === null);
  if (run.run.status === "completed" || pending.length === 0) {
    emit({ type: "phase", phase: "done", message: run.claims.length === 0 ? say(deps, "progress.noClaims") : say(deps, "progress.done") });
    return;
  }

  emit({ type: "phase", phase: "checking", message: say(deps, "progress.checking") });
  const work = (claim: ClaimView) => checkClaim(deps, claim.id, emit, signal);
  const options = { signal, onError: (error: unknown, claim: ClaimView) => emit({ type: "claimError", id: claim.id, message: messageOf(error, deps.t, deps.locale) }) };
  // The server looks each reference up online once and keeps the answer, but claims checked at the same moment
  // all start with nothing kept and all look the same reference up (slow, and it trips the services' rate limits).
  // So check one claim per distinct citation first, then the rest, which find the answer already kept.
  const { first, rest } = oneClaimPerCitation(pending);
  await runPool(first, CHECK_CONCURRENCY, work, options);
  if (!signal.aborted) await runPool(rest, CHECK_CONCURRENCY, work, options);
  if (signal.aborted) return;

  emit({ type: "loaded", run: await deps.api.getRun(runId) });
  emit({ type: "phase", phase: "done", message: say(deps, "progress.done") });
}

/** Extracts every unit (the server skips any already done). Returns false, after reporting it, if one failed. */
async function extractAll(deps: VerifyDeps, runId: string, unitCount: number, emit: Emit, signal: AbortSignal): Promise<boolean> {
  emit({ type: "phase", phase: "extracting", message: say(deps, "progress.extracting") });
  let extracted = 0;
  const failures: string[] = [];
  // Parts the AI kept failing on after the usual retries.
  const unread: number[] = [];
  await runPool(
    Array.from({ length: unitCount }, (_, unit) => unit),
    EXTRACT_CONCURRENCY,
    async (unit) => {
      try {
        await deps.api.extract(runId, unit);
      } catch (error) {
        if (!(error instanceof ApiClientError && error.code === "model_unavailable")) throw error;
        unread.push(unit);
        return;
      }
      extracted += 1;
      emit({ type: "extracted", unitsExtracted: extracted });
    },
    { signal, onError: (error) => failures.push(messageOf(error, deps.t, deps.locale)) },
  );
  if (signal.aborted) return false;
  if (failures.length > 0) {
    emit({ type: "failed", message: failures[0]! });
    return false;
  }
  if (unread.length > 0) {
    // A few parts the AI could not read do not block the scan: they are recorded as not read, and the results name
    // them with a "Read again" button. When most of the draft failed, the AI is down, not one hard part: say so, and
    // leave the parts unrecorded so "Try again" reads them.
    if (unread.length > Math.max(1, Math.floor(unitCount / 4))) {
      emit({ type: "failed", message: say(deps, "err.model_unavailable") });
      return false;
    }
    try {
      for (const unit of unread) {
        await deps.api.extract(runId, unit, "skip");
        extracted += 1;
        emit({ type: "extracted", unitsExtracted: extracted });
      }
    } catch (error) {
      if (!signal.aborted) emit({ type: "failed", message: messageOf(error, deps.t, deps.locale) });
      return false;
    }
  }
  return true;
}

/** Reads a part of the draft that the AI could not read before, then shows the results again. */
export async function retryPart(deps: VerifyDeps, runId: string, unit: number, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    await deps.api.extract(runId, unit, "retry");
  } catch {
    // Still not readable: the part stays listed, with its button.
  }
  if (signal.aborted) return;
  const run = await deps.api.getRun(runId);
  emit({ type: "loaded", run });
  // New cited claims wait for the check, like after any scan.
  if (run.claims.some((claim) => claim.verdict === null)) emit({ type: "phase", phase: "scanned", message: "" });
}

/**
 * The end of the scan: read the run and stop. The claims that need no lookup (no citation, or a citation that is not
 * in the reference list) already have their verdict from the server. The cited ones wait, in the "scanned" phase,
 * until the student starts the check; a run with nothing left to check is simply done.
 */
async function finishScan(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const run = await deps.api.getRun(runId);
  emit({ type: "loaded", run });
  if (signal.aborted) return;
  const pending = run.claims.filter((claim) => claim.verdict === null);
  if (run.run.status === "completed" || pending.length === 0) {
    emit({ type: "phase", phase: "done", message: run.claims.length === 0 ? say(deps, "progress.noClaims") : say(deps, "progress.done") });
    return;
  }
  emit({ type: "phase", phase: "scanned", message: "" });
}

/** Starts the check of the claims the scan left pending (the cited ones). Safe to start again after a stop. */
export async function checkCited(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    await checkRemaining(deps, runId, emit, signal);
  } catch (error) {
    if (!signal.aborted) emit({ type: "failed", message: messageOf(error, deps.t, deps.locale) });
  }
}

/** A new check: create the run, scan the draft for claims, and stop at the scan. Failures are a `failed` event. */
export async function runVerification(deps: VerifyDeps, input: VerifyInput, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    emit({ type: "phase", phase: "starting", message: say(deps, "progress.starting") });
    const created = await deps.api.createRun(input);
    emit({ type: "run", runId: created.runId, unitCount: created.unitCount });
    if (signal.aborted) return;
    if (!(await extractAll(deps, created.runId, created.unitCount, emit, signal))) return;
    await finishScan(deps, created.runId, emit, signal);
  } catch (error) {
    if (!signal.aborted) emit({ type: "failed", message: messageOf(error, deps.t, deps.locale) });
  }
}

/**
 * Picks up a check that was interrupted (a closed tab, a reload): extraction of any unit already done is skipped
 * by the server, and only claims without a verdict are checked.
 */
export async function resumeVerification(deps: VerifyDeps, runId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  try {
    emit({ type: "phase", phase: "starting", message: say(deps, "progress.reopening") });
    const run = await deps.api.getRun(runId);
    emit({ type: "loaded", run });
    if (signal.aborted) return;
    if (run.run.status === "extracting" && !(await extractAll(deps, runId, run.run.unitCount, emit, signal))) return;
    await finishScan(deps, runId, emit, signal);
  } catch (error) {
    if (!signal.aborted) emit({ type: "failed", message: messageOf(error, deps.t, deps.locale) });
  }
}

/** Checks one claim again, after its check failed in the browser. */
export async function retryClaim(deps: VerifyDeps, runId: string, claimId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  emit({ type: "claimRetry", id: claimId });
  try {
    await checkClaim(deps, claimId, emit, signal);
    emit({ type: "loaded", run: await deps.api.getRun(runId) });
  } catch (error) {
    if (!signal.aborted) emit({ type: "claimError", id: claimId, message: messageOf(error, deps.t, deps.locale) });
  }
}
