// Run handlers: create a run from a draft, extract its claims one unit per request, and read its results.
//
//   POST /api/runs               parse the draft (paste or .docx), save the run and its reference list
//   POST /api/runs/:id/extract   extract the claims of one unit ({ unit: n }); the browser calls it per unit
//   GET  /api/runs/:id           progress, every claim with its verdict, and the ranked fix list
//
// A run is 'extracting' until every unit has been extracted, then 'checking' (claims can be checked), then
// 'completed' when every claim has a verdict. A repeated extract request for a unit changes nothing.
import { z } from "zod";
import type postgres from "postgres";
import { atomically } from "../db-tx";
import { lengthBucket, logEvent } from "../events";
import { rankFixList } from "../fix-list";
import { extractWithFallback, noDrops, type FallbackResult } from "../pipeline/extract-claims";
import {
  MAX_DOCX_BYTES,
  parseDraft,
  parseReferenceList,
  splitIntoUnits,
  unitParagraphs,
  type ParsedDraft,
} from "../pipeline/parse-draft";
import { containsQuote } from "../rag/normalize";
import { sourcesForRun } from "./sources-found";
import { saveEarlyVerdicts } from "../pipeline/scan";
import { completeRunIfFinished } from "../pipeline/save-verdict";
import type { Verdict } from "../pipeline/types";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readJson, readUpload } from "./http";

/** Starting value: how many runs one session keeps. Creating one more drops the oldest. */
export const MAX_RUNS_PER_SESSION = 20;
/**
 * The most a create-run request may send: a draft at its character limit (up to about 750 KB in UTF-8, at three
 * bytes a character) plus a reference list of up to MAX_REFERENCES entries. Larger than the general JSON limit, so
 * the draft and reference limits give the specific error, and a long draft with a long list is not refused as
 * "too large".
 */
export const MAX_CREATE_BODY_BYTES = 1_100_000;
/** Claims of unit `u` get positions u * 100 + 1, u * 100 + 2, ... (a unit has at most 40 claims). */
const POSITION_STRIDE = 100;

const createBody = z.object({ draft: z.string(), references: z.string().optional() });
const extractBody = z.object({ unit: z.number().int().min(0), mode: z.enum(["read", "skip", "retry"]).default("read") });

export async function createRun(context: ApiContext, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;

  let parsed: ParsedDraft;
  let inputType: "paste" | "docx";
  let suppliedReferences: string | undefined;

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const upload = await readUpload(request, "file", MAX_DOCX_BYTES);
    parsed = await parseDraft({ kind: "docx", buffer: Buffer.from(upload.bytes) });
    inputType = "docx";
    const field = upload.form.get("references");
    suppliedReferences = typeof field === "string" ? field : undefined;
  } else {
    const body = createBody.parse(await readJson(request, MAX_CREATE_BODY_BYTES));
    parsed = await parseDraft({ kind: "paste", text: body.draft });
    inputType = "paste";
    suppliedReferences = body.references;
  }

  const referenceText = suppliedReferences?.trim() ? suppliedReferences : (parsed.referenceText ?? "");
  const entries = parseReferenceList(referenceText);

  const runId = await atomically(sql)(async (tx) => {
    // A full session drops its oldest checks to make room. The screen only ever reopens the latest check, so
    // an older one is unreachable, and blocking the student with no way to delete one would be a dead end.
    // Claims, verdicts, units and reference entries go with the run (on delete cascade).
    await tx`
      delete from runs where id in (
        select id from runs where session_id = ${sessionId}
        order by created_at asc, id asc
        limit greatest((select count(*) from runs where session_id = ${sessionId}) - ${MAX_RUNS_PER_SESSION - 1}, 0)
      )`;
    const [run] = await tx<{ id: string }[]>`
      insert into runs (session_id, draft_text, input_type, status, unit_count)
      values (${sessionId}, ${parsed.text}, ${inputType}, 'extracting', ${parsed.units.length})
      returning id`;
    if (entries.length > 0) {
      await tx`
        insert into reference_entries (run_id, session_id, raw_text, position)
        select ${run!.id}::uuid, ${sessionId}::uuid, r.t, r.n
        from unnest(${entries}::text[], ${entries.map((_, i) => i + 1)}::int[]) as r(t, n)`;
    }
    await logEvent(tx, sessionId, "draft_submitted", {
      input_type: inputType,
      length_bucket: lengthBucket(parsed.text.length),
    });
    if (entries.length > 0) await logEvent(tx, sessionId, "references_added", { count: entries.length });
    return run!.id;
  });

  return jsonResponse(
    { runId, status: "extracting", unitCount: parsed.units.length, referenceCount: entries.length },
    201,
  );
}

interface RunRow {
  id: string;
  status: "extracting" | "checking" | "completed" | "failed";
  unit_count: number;
  claim_count: number;
  draft_text: string;
}

/** The run's extraction progress, read through `reader` (a pool or a transaction). */
async function extractionProgress(reader: postgres.Sql, runId: string) {
  const [run] = await reader<RunRow[]>`
    select id, status, unit_count, claim_count, draft_text from runs where id = ${runId}`;
  const [units] = await reader<{ n: number }[]>`select count(*)::int as n from run_units where run_id = ${runId}`;
  return {
    status: run!.status,
    unitCount: run!.unit_count,
    unitsExtracted: units?.n ?? 0,
    claimCount: run!.claim_count,
  };
}

/**
 * POST /api/runs/:id/extract { unit, mode }:
 * - "read" (the default): read the unit for claims. A unit the model fails on is read again as two halves; if one
 *   half still fails, the claims of the other are kept and the unit is marked failed.
 * - "skip": the browser has given up on the unit after its retries. It is recorded as failed with no claims and no
 *   model call, so the scan can finish and the screen can say which part was not read.
 * - "retry": read a failed unit again (the student pressed "Read again"). Its old claims are replaced.
 * A repeated "read" or "skip" of a unit that is already recorded changes nothing.
 */
export async function extractUnit(context: ApiContext, runId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  assertId(runId);
  const { unit, mode } = extractBody.parse(await readJson(request));

  const [run] = await sql<RunRow[]>`
    select id, status, unit_count, claim_count, draft_text from runs
    where id = ${runId} and session_id = ${sessionId}`;
  if (!run) throw new ApiError(404, "not_found", "Not found.");
  if (unit >= run.unit_count) throw new ApiError(400, "unit_out_of_range", "That part of the draft does not exist.");

  /** A repeated request changes nothing and makes no model call. */
  const alreadyExtracted = async (reader: postgres.Sql) =>
    jsonResponse({ unit, alreadyExtracted: true, claimsAdded: 0, ...(await extractionProgress(reader, run.id)) });

  const [seen] = await sql<{ failed: boolean }[]>`
    select failed from run_units where run_id = ${run.id} and unit_index = ${unit}`;
  if (mode === "retry") {
    if (!seen?.failed) return alreadyExtracted(sql);
  } else if (run.status !== "extracting" || seen) {
    return alreadyExtracted(sql);
  }

  const units = splitIntoUnits(run.draft_text);
  if (units.length !== run.unit_count) throw new Error("The stored draft no longer matches its unit count.");

  // The model call is outside the transaction: it is a network call.
  const extraction: FallbackResult =
    mode === "skip"
      ? { claims: [], dropped: noDrops(), partial: true }
      : await extractWithFallback(context.deps.llm, units[unit]!.text);
  const failed = extraction.partial;

  return atomically(sql)(async (tx) => {
    const [locked] = await tx<{ id: string; status: RunRow["status"] }[]>`select id, status from runs where id = ${run.id} for update`;
    if (!locked) throw new ApiError(404, "not_found", "Not found.");

    if (mode === "retry") {
      const replaced = await tx<{ unit_index: number }[]>`
        update run_units set claim_count = ${extraction.claims.length}, failed = ${failed}
        where run_id = ${run.id} and unit_index = ${unit} and failed
        returning unit_index`;
      // Another request read it again while this one waited on the model: keep its result.
      if (replaced.length === 0) return alreadyExtracted(tx);
      const removed = await tx`
        delete from claims where run_id = ${run.id}
          and position between ${unit * POSITION_STRIDE + 1} and ${unit * POSITION_STRIDE + POSITION_STRIDE - 1}`;
      await tx`update runs set claim_count = claim_count - ${removed.count} where id = ${run.id}`;
    } else {
      const recorded = await tx<{ unit_index: number }[]>`
        insert into run_units (run_id, unit_index, claim_count, failed)
        values (${run.id}, ${unit}, ${extraction.claims.length}, ${failed})
        on conflict (run_id, unit_index) do nothing returning unit_index`;
      // Another request extracted this unit while this one waited on the model: keep its claims.
      if (recorded.length === 0) return alreadyExtracted(tx);
    }

    const claims = extraction.claims;
    if (claims.length > 0) {
      // The heading each claim sits under, for grouping the results by section.
      const paragraphs = unitParagraphs(run.draft_text, unit);
      const sections = claims.map((claim) => paragraphs.find((p) => containsQuote(claim.text, p.text))?.heading ?? null);
      await tx`
        insert into claims (run_id, session_id, position, text, citation_text, citation_inherited, section, need)
        select ${run.id}::uuid, ${sessionId}::uuid, c.pos, c.txt, c.cite, c.inh, c.sec, c.need
        from unnest(
          ${claims.map((_, i) => unit * POSITION_STRIDE + i + 1)}::int[],
          ${claims.map((claim) => claim.text)}::text[],
          ${claims.map((claim) => claim.citation)}::text[],
          ${claims.map((claim) => claim.citationInherited)}::boolean[],
          ${sections}::text[],
          ${claims.map((claim) => claim.need)}::text[]
        ) as c(pos, txt, cite, inh, sec, need)`;
      await tx`update runs set claim_count = claim_count + ${claims.length} where id = ${run.id}`;
    }

    const progress = await extractionProgress(tx, run.id);
    if (mode === "retry" && locked.status !== "extracting") {
      // The scan had already ended: the new claims get their early verdicts now, and a closed run with new cited
      // claims opens again for the check.
      await tx`update runs set status = 'checking', completed_at = null where id = ${run.id}`;
      await saveEarlyVerdicts(tx, sessionId, run.id);
      await completeRunIfFinished(tx, sessionId, run.id);
    } else if (progress.unitsExtracted >= run.unit_count && locked.status === "extracting") {
      await tx`update runs set status = 'checking' where id = ${run.id}`;
      await logEvent(tx, sessionId, "run_started", { claim_count: progress.claimCount });
      // The scan: claims with no citation, an unreadable one, or one that is not in the reference list get their
      // verdict now, with no network call. The others wait for the check the student starts.
      await saveEarlyVerdicts(tx, sessionId, run.id);
      // Claims may already have verdicts, and a draft with no claims has none to wait for.
      await completeRunIfFinished(tx, sessionId, run.id);
    }

    return jsonResponse({
      unit,
      alreadyExtracted: false,
      claimsAdded: claims.length,
      failed,
      dropped: extraction.dropped,
      ...(await extractionProgress(tx, run.id)),
    });
  });
}

interface ClaimRow {
  id: string;
  position: number;
  text: string;
  citation_text: string | null;
  citation_inherited: boolean;
  section: string | null;
  need: "must" | "should";
  sources_searched: boolean;
  citation_source: "draft" | "found";
  status: "pending" | "checking" | "done";
  verdict: Verdict | null;
  quote: string | null;
  page: number | null;
  reason: string | null;
  exit_stage: number | null;
  fix_suggestion: string | null;
}

/**
 * Deletes one of the caller's checks now: the draft text, claims, verdicts and reference entries go with it (on
 * delete cascade). Events are kept: they hold only ids, counts and buckets. Source PDFs are separate and have
 * their own delete.
 */
export async function deleteRun(context: ApiContext, runId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  assertId(runId);
  const rows = await sql<{ id: string }[]>`
    delete from runs where id = ${runId} and session_id = ${context.sessionId} returning id`;
  if (rows.length === 0) throw new ApiError(404, "not_found", "Not found.");
  return new Response(null, { status: 204 });
}

export async function getRun(context: ApiContext, runId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  assertId(runId);

  const [run] = await sql<
    { id: string; status: string; unit_count: number; claim_count: number; created_at: Date; completed_at: Date | null }[]
  >`
    select id, status, unit_count, claim_count, created_at, completed_at from runs
    where id = ${runId} and session_id = ${sessionId}`;
  if (!run) throw new ApiError(404, "not_found", "Not found.");

  const [units] = await sql<{ n: number }[]>`select count(*)::int as n from run_units where run_id = ${run.id}`;
  // Parts the AI could not read, named by the heading they start under. The draft is read only when there are any.
  const failedUnits = await sql<{ unit_index: number }[]>`
    select unit_index from run_units where run_id = ${run.id} and failed order by unit_index`;
  let failedParts: { unit: number; section: string | null }[] = [];
  if (failedUnits.length > 0) {
    const [draft] = await sql<{ draft_text: string }[]>`select draft_text from runs where id = ${run.id}`;
    failedParts = failedUnits.map((row) => ({
      unit: row.unit_index,
      section: unitParagraphs(draft!.draft_text, row.unit_index)[0]?.heading ?? null,
    }));
  }
  const claimRows = await sql<ClaimRow[]>`
    select c.id, c.position, c.text, c.citation_text, c.citation_inherited, c.section, c.need, c.citation_source, c.sources_searched_at is not null as sources_searched, c.status,
           v.verdict, v.quote, v.page, v.reason, v.exit_stage, v.fix_suggestion
    from claims c left join verdicts v on v.claim_id = c.id
    where c.run_id = ${run.id} order by c.position`;
  const references = await sql<
    { position: number; raw_text: string; resolution: string; resolved_title: string | null; year_mismatch: boolean }[]
  >`
    select position, raw_text, resolution, resolved_title, year_mismatch from reference_entries
    where run_id = ${run.id} order by position`;

  const found = await sourcesForRun(sql, run.id);
  const claims = claimRows.map((row) => ({
    id: row.id,
    position: row.position,
    text: row.text,
    citation: row.citation_text,
    citationInherited: row.citation_inherited,
    section: row.section,
    need: row.need,
    sourcesSearched: row.sources_searched,
    citationSource: row.citation_source,
    sources: found.get(row.id) ?? [],
    status: row.status,
    verdict: row.verdict,
    quote: row.quote,
    page: row.page,
    reason: row.reason,
    exitStage: row.exit_stage,
    fixSuggestion: row.fix_suggestion,
  }));

  const counts: Partial<Record<Verdict, number>> = {};
  for (const claim of claims) if (claim.verdict) counts[claim.verdict] = (counts[claim.verdict] ?? 0) + 1;

  return jsonResponse({
    run: {
      id: run.id,
      status: run.status,
      unitCount: run.unit_count,
      unitsExtracted: units?.n ?? 0,
      claimCount: run.claim_count,
      createdAt: run.created_at,
      completedAt: run.completed_at,
    },
    progress: { checked: claims.filter((c) => c.verdict !== null).length, total: claims.length },
    counts,
    fixList: rankFixList(claims).map((claim) => claim.id),
    failedParts,
    claims,
    references: references.map((ref) => ({
      position: ref.position,
      text: ref.raw_text,
      resolution: ref.resolution,
      resolvedTitle: ref.resolved_title,
      yearMismatch: ref.year_mismatch,
    })),
  });
}
