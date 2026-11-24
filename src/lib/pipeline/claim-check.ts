// Stages 3 to 9 for one claim. This is what one browser-triggered request runs (docs/architecture.md):
//   2/3/4  runPrelude: citation, reference list, Crossref/OpenAlex (cached per run), uploaded source
//   6      retrieve the top passages from the cited source(s) only
//   7      judge the claim against the passages
//   8      verify the quote in code; a quote that does not verify becomes Can't tell. A Supported verdict then
//          has its numbers checked and gets a second look from the review model (review.ts)
//   9      save the verdict and log the events
// "Fix this claim" runs after stage 8 for Partial and Contradicted, using only the verified quote.
//
// Retries: a failed lookup, or a model that is unavailable or times out, asks the browser to try again (`retry`)
// and never ends the claim; the browser gives up after a few rounds and offers "Try again" on that card. A model that
// keeps giving unusable answers ends the claim as Can't tell after MAX_CLAIM_ATTEMPTS attempts.
// The function is idempotent: a claim that already has a verdict returns it without any lookup or model call.
import type postgres from "postgres";
import { LlmOutputError, LlmUnavailableError, type Llm } from "../llm/adapter";
import { embedQuery } from "../rag/embed";
import { retrieveTopChunks, type SqlLike } from "../rag/retrieve";
import { findSourceDocument, findSourceForEntry } from "./find-source";
import { suggestFix } from "./fix";
import { judgeClaim, type JudgePassage } from "./judge";
import { needsGloss } from "./language";
import { runPrelude, type PreludeEntry } from "./prelude";
import { resolveEntryCached } from "./reference-cache";
import { resolveReference, type ReferenceResolution } from "./resolve-reference";
import { reviewSupported } from "./review";
import { getVerdict, saveVerdict, type SavedVerdict } from "./save-verdict";
import type { ExitStage } from "./types";
import { verifyJudgment } from "./verify-quote";

export const MAX_CLAIM_ATTEMPTS = 3;
/** A translation of the quote is one or two sentences; anything longer is cut. */
const MAX_GLOSS_CHARS = 800;

export interface CheckClaimDeps {
  llm: Llm;
  /** Looks one reference entry up. Defaults to Crossref then OpenAlex. Tests pass a fake. */
  resolve?: (raw: string) => Promise<ReferenceResolution>;
  now?: () => number;
}

export type CheckClaimResult =
  | { outcome: "done"; verdict: SavedVerdict }
  /** A lookup or model call failed. The browser should call again; `attempt` is how many have been made. */
  | { outcome: "retry"; reason: string; attempt: number };

interface ClaimRow {
  id: string;
  run_id: string;
  text: string;
  citation_text: string | null;
  status: "pending" | "checking" | "done";
}

export async function checkClaim(
  db: SqlLike,
  deps: CheckClaimDeps,
  args: { sessionId: string; claimId: string },
): Promise<CheckClaimResult> {
  const sql = db as postgres.Sql;
  const now = deps.now ?? Date.now;
  const started = now();
  const { sessionId } = args;

  const [claim] = await sql<ClaimRow[]>`
    select id, run_id, text, citation_text, status from claims
    where id = ${args.claimId} and session_id = ${sessionId}`;
  if (!claim) throw new Error("Claim not found for this session.");

  const alreadyDone = async (): Promise<CheckClaimResult | null> => {
    const existing = await getVerdict(sql, { sessionId, claimId: claim.id });
    return existing ? { outcome: "done", verdict: existing } : null;
  };
  if (claim.status === "done") {
    const existing = await alreadyDone();
    if (existing) return existing;
  }

  const [bumped] = await sql<{ attempts: number }[]>`
    update claims set status = 'checking', attempts = attempts + 1
    where id = ${claim.id} and status <> 'done' returning attempts`;
  if (!bumped) {
    const existing = await alreadyDone();
    if (existing) return existing;
    throw new Error("Claim could not be claimed for checking.");
  }
  const attempt = bumped.attempts;

  const finish = async (
    exit: { verdict: SavedVerdict["verdict"]; exitStage: ExitStage; reason: string },
    extra: {
      quote?: string | null;
      page?: number | null;
      chunkId?: string | null;
      fixSuggestion?: string | null;
      quoteGloss?: string | null;
    } = {},
  ): Promise<CheckClaimResult> => {
    const saved = await saveVerdict(sql, {
      sessionId,
      claimId: claim.id,
      verdict: exit.verdict,
      quote: extra.quote ?? null,
      page: extra.page ?? null,
      chunkId: extra.chunkId ?? null,
      reason: exit.reason,
      exitStage: exit.exitStage,
      fixSuggestion: extra.fixSuggestion ?? null,
      quoteGloss: extra.quoteGloss ?? null,
      latencyMs: now() - started,
      retries: attempt - 1,
    });
    return { outcome: "done", verdict: saved };
  };

  /**
   * Ask for another attempt. A passing failure (a lookup or the model unavailable, or a timeout) never ends the
   * claim: the browser retries, then offers "Try again" (UAT 23 Nov 2026: three claims were saved as Can't tell only
   * because the model timed out). An answer the model keeps getting wrong ends as Can't tell once the attempts are used.
   */
  const failOrRetry = async (stage: ExitStage, reason: string, passing: boolean): Promise<CheckClaimResult> => {
    if (passing || attempt < MAX_CLAIM_ATTEMPTS) return { outcome: "retry", reason, attempt };
    return finish({
      verdict: "cant_tell",
      exitStage: stage,
      reason: `The check could not be completed after ${attempt} attempts: ${reason}`,
    });
  };

  let stage: ExitStage = 3;
  try {
    const rows = await sql<{ id: string; position: number; raw_text: string; document_id: string | null }[]>`
      select id, position, raw_text, document_id from reference_entries
      where run_id = ${claim.run_id} order by position`;
    const entries: PreludeEntry[] = rows.map((row) => ({
      id: row.id,
      position: row.position,
      raw: row.raw_text,
      documentId: row.document_id,
    }));

    const lookUp = deps.resolve ?? ((raw: string) => resolveReference(raw));
    const prelude = await runPrelude({ citation: claim.citation_text }, entries, {
      resolve: (entry) => resolveEntryCached(sql, { entryId: entry.id, sessionId, raw: entry.raw, resolve: lookUp }),
      findSource: (entry, resolution) =>
        findSourceDocument(sql, {
          sessionId,
          linkedDocumentId: entry.documentId,
          doi: resolution.doi,
          title: resolution.title,
        }),
      findUploaded: (entry) =>
        findSourceForEntry(sql, { sessionId, linkedDocumentId: entry.documentId, raw: entry.raw }),
    });

    if (prelude.outcome === "exit") return finish(prelude.exit);
    if (prelude.outcome === "retry") return failOrRetry(3, prelude.reason, true);

    stage = 6;
    const queryEmbedding = await embedQuery(deps.llm, claim.text);
    const retrieved = await retrieveTopChunks(sql, {
      sessionId,
      queryEmbedding,
      queryText: claim.text,
      documentIds: prelude.documentIds,
    });
    if (retrieved.length === 0) {
      return finish({
        verdict: "cant_tell",
        exitStage: 6,
        reason: "No passages could be retrieved from the source.",
      });
    }
    const passages: JudgePassage[] = retrieved.map((chunk) => ({
      chunkId: chunk.chunkId,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
    }));

    stage = 7;
    const raw = await judgeClaim(deps.llm, claim.text, passages);

    stage = 8;
    const checkedQuote = verifyJudgment(raw, passages);
    // A Supported verdict gets its numbers checked and a second look (review.ts); any other verdict passes through.
    const verified = await reviewSupported(deps.llm, {
      claimText: claim.text,
      citation: claim.citation_text,
      verified: checkedQuote,
      passages,
    });
    const changedAtStage8 = Boolean(checkedQuote.downgradedFrom) || verified !== checkedQuote;

    let fixSuggestion: string | null = null;
    if ((verified.verdict === "partial" || verified.verdict === "contradicted") && verified.quote) {
      fixSuggestion = await suggestFix(deps.llm, {
        claimText: claim.text,
        quote: verified.quote,
        verdict: verified.verdict,
        citation: claim.citation_text,
      });
    }

    // For an Indonesian claim with an English quote, the judge's translation of the quote, to show under it. Display
    // text only: the verified quote stays the evidence, and a translation is never kept without one.
    const gloss = raw.gloss?.replace(/\s+/g, " ").trim() ?? "";
    const quoteGloss =
      verified.quote && gloss && needsGloss(claim.text, verified.quote) ? gloss.slice(0, MAX_GLOSS_CHARS) : null;

    return finish(
      { verdict: verified.verdict, exitStage: changedAtStage8 ? 8 : 7, reason: verified.reason },
      { quote: verified.quote, page: verified.page, chunkId: verified.chunkId, fixSuggestion, quoteGloss },
    );
  } catch (error) {
    if (error instanceof LlmUnavailableError || error instanceof LlmOutputError) {
      return failOrRetry(stage, error.message, error instanceof LlmUnavailableError);
    }
    throw error;
  }
}
