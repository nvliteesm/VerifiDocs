// Stage 9: save the verdict and log the events.
//
// - One verdict per claim. Saving is idempotent: if a verdict already exists the first one wins, nothing is
//   overwritten and no event is logged twice, so a retried or overlapping check is harmless.
// - The save, the claim's 'done' status and the events happen in one transaction, so a failure leaves nothing
//   half-written. The database itself enforces the evidence rules (see db/migrations/0001_init.sql), so a
//   Supported verdict without a quote and page, or a quote on an unverified verdict, cannot be stored.
// - Events carry ids, counts and buckets only (src/lib/events.ts). The quote, reason and claim text stay in
//   the verdict and claim rows and never reach an event.
// - A run is closed (and `run_completed` logged, once) only when its status is 'checking', meaning every claim
//   has been extracted, and its last claim now has a verdict.
import type postgres from "postgres";
import { atomically } from "../db-tx";
import { logEvent } from "../events";
import type { SqlLike } from "../rag/retrieve";
import { VERDICTS, type ExitStage, type Verdict } from "./types";

export interface SaveVerdictArgs {
  sessionId: string;
  claimId: string;
  verdict: Verdict;
  quote: string | null;
  page: number | null;
  chunkId: string | null;
  reason: string;
  exitStage: ExitStage;
  /** Only for partial and contradicted; the database rejects it otherwise. */
  fixSuggestion: string | null;
  /** A translation of the quote for the student to read (needsGloss); only with a quote. Never the evidence. */
  quoteGloss?: string | null;
  latencyMs: number;
  retries: number;
}

export interface SavedVerdict {
  claimId: string;
  verdict: Verdict;
  quote: string | null;
  page: number | null;
  reason: string;
  exitStage: number;
  fixSuggestion: string | null;
  quoteGloss: string | null;
  /** False when a verdict already existed and was returned unchanged. */
  created: boolean;
  /** True when this save closed the run. */
  runCompleted: boolean;
}

interface VerdictRow {
  claim_id: string;
  verdict: Verdict;
  quote: string | null;
  page: number | null;
  reason: string;
  exit_stage: number;
  fix_suggestion: string | null;
  quote_gloss: string | null;
}

function toSaved(row: VerdictRow, created: boolean, runCompleted: boolean): SavedVerdict {
  return {
    claimId: row.claim_id,
    verdict: row.verdict,
    quote: row.quote,
    page: row.page,
    reason: row.reason,
    exitStage: row.exit_stage,
    fixSuggestion: row.fix_suggestion,
    quoteGloss: row.quote_gloss,
    created,
    runCompleted,
  };
}

/** The saved verdict for a claim, or null if it has none yet. Scoped to the session. */
export async function getVerdict(
  db: SqlLike,
  args: { sessionId: string; claimId: string },
): Promise<SavedVerdict | null> {
  const sql = db as postgres.Sql;
  const [row] = await sql<VerdictRow[]>`
    select claim_id, verdict, quote, page, reason, exit_stage, fix_suggestion, quote_gloss
    from verdicts where claim_id = ${args.claimId} and session_id = ${args.sessionId}`;
  return row ? toSaved(row, false, false) : null;
}

/**
 * Closes the run, and logs `run_completed` once, if it is in the 'checking' state and every claim has a verdict.
 * Called after a verdict is saved, and after the last unit is extracted (claims may already be done by then,
 * and a draft with no claims has none to wait for). Returns true only for the call that closed the run.
 * Must run inside a transaction.
 */
export async function completeRunIfFinished(tx: postgres.Sql, sessionId: string, runId: string): Promise<boolean> {
  const [open] = await tx<{ n: number }[]>`
    select count(*)::int as n from claims where run_id = ${runId} and status <> 'done'`;
  if ((open?.n ?? 1) !== 0) return false;

  const closed = await tx<{ duration_ms: number }[]>`
    update runs set status = 'completed', completed_at = now()
    where id = ${runId} and status = 'checking'
    returning (extract(epoch from (now() - created_at)) * 1000)::int as duration_ms`;
  if (closed.length === 0) return false;

  const rows = await tx<{ verdict: Verdict; n: number }[]>`
    select v.verdict, count(*)::int as n
    from verdicts v join claims c on c.id = v.claim_id
    where c.run_id = ${runId} group by v.verdict`;
  const verdictCounts: Partial<Record<Verdict, number>> = {};
  for (const row of rows) if (VERDICTS.includes(row.verdict)) verdictCounts[row.verdict] = row.n;
  await logEvent(tx, sessionId, "run_completed", {
    duration_ms: Math.max(0, closed[0]!.duration_ms),
    verdict_counts: verdictCounts,
  });
  return true;
}

export async function saveVerdict(db: SqlLike, args: SaveVerdictArgs): Promise<SavedVerdict> {
  return atomically(db)(async (tx) => {
    // Lock the claim so two overlapping saves for it are serialized.
    const [claim] = await tx<{ id: string; run_id: string }[]>`
      select id, run_id from claims where id = ${args.claimId} and session_id = ${args.sessionId} for update`;
    if (!claim) throw new Error("Claim not found for this session.");

    const inserted = await tx<{ id: string }[]>`
      insert into verdicts
        (claim_id, session_id, verdict, quote, page, chunk_id, reason, exit_stage, fix_suggestion, quote_gloss, latency_ms, retries)
      values
        (${args.claimId}, ${args.sessionId}, ${args.verdict}, ${args.quote}, ${args.page}, ${args.chunkId},
         ${args.reason}, ${args.exitStage}, ${args.fixSuggestion}, ${args.quoteGloss ?? null},
         ${Math.max(0, Math.round(args.latencyMs))}, ${Math.max(0, args.retries)})
      on conflict (claim_id) do nothing
      returning id`;
    const created = inserted.length > 0;

    await tx`update claims set status = 'done' where id = ${args.claimId}`;

    if (created) {
      await logEvent(tx, args.sessionId, "claim_checked", {
        verdict: args.verdict,
        exit_stage: args.exitStage,
        latency_ms: Math.max(0, Math.round(args.latencyMs)),
        retries: Math.max(0, args.retries),
      });
      if (args.fixSuggestion && (args.verdict === "partial" || args.verdict === "contradicted")) {
        await logEvent(tx, args.sessionId, "fix_suggested", { verdict: args.verdict });
      }
    }

    const runCompleted = await completeRunIfFinished(tx, args.sessionId, claim.run_id);

    const [stored] = await tx<VerdictRow[]>`
      select claim_id, verdict, quote, page, reason, exit_stage, fix_suggestion, quote_gloss
      from verdicts where claim_id = ${args.claimId}`;
    return toSaved(stored!, created, runCompleted);
  });
}
