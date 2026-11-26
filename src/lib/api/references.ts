// Source discovery for the reference list (docs/decisions.md, 26 Nov 2026). One short request per reference, driven by
// the browser, the same way claims are checked: nothing runs long.
//
//   GET  /api/runs/:id/references                       every entry with where its source file stands
//   POST /api/runs/:id/references/:entry/discover       look the entry up: matched, possible, or not retrieved
//   POST /api/runs/:id/references/:entry/retrieve       fetch a matched entry's open-access PDF and attach it
//   POST /api/runs/:id/references/:entry/confirm        { accept }: the student's answer on a possible match
//   POST /api/runs/:id/references/:entry/link           { documentId }: the student's own PDF for this entry
//
// A low-confidence match is never attached: it is "possible" until the student confirms it. A source that cannot be
// found says nothing about whether the reference exists. A retrieved PDF is read and its bytes dropped, like an upload
// (hard rule 4), and is reused within the session only (never shared between students).
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { logEvent } from "../events";
import { discoverReference, referenceByline, referenceTitle, type SourceCandidate } from "../pipeline/discover-reference";
import { PdfFetchError, fetchPdf } from "../pipeline/fetch-pdf";
import { IngestError, createDocumentFromPdf } from "../pipeline/ingest";
import { resolveEntryCached } from "../pipeline/reference-cache";
import { classifyReference, type ReferenceType } from "../pipeline/reference-type";
import { defaultFetch, resolveReference, type FetchFn } from "../pipeline/resolve-reference";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readJson } from "./http";

export type SourceState = "pending" | "matched" | "retrieved" | "matched_no_file" | "possible" | "not_retrieved" | "uploaded";

export interface ReferenceSourceView {
  id: string;
  position: number;
  /** The entry exactly as the student wrote it. */
  text: string;
  /** Its title and who/when, for showing a missing source by its real name. */
  title: string;
  byline: string;
  refType: ReferenceType;
  sourceState: SourceState;
  documentId: string | null;
  /** The matched or possible work, without its PDF link. */
  candidate: { title: string; year: number | null; doi: string | null; venue: string | null; hasPdf: boolean } | null;
}

interface Row {
  id: string;
  position: number;
  raw_text: string;
  document_id: string | null;
  source_state: SourceState;
  ref_type: string | null;
  candidate: SourceCandidate | null;
}

export function toView(row: Row): ReferenceSourceView {
  return {
    id: row.id,
    position: row.position,
    text: row.raw_text,
    title: referenceTitle(row.raw_text),
    byline: referenceByline(row.raw_text),
    refType: (row.ref_type as ReferenceType | null) ?? classifyReference(row.raw_text),
    sourceState: row.source_state,
    documentId: row.document_id,
    candidate: row.candidate
      ? { title: row.candidate.title, year: row.candidate.year, doi: row.candidate.doi, venue: row.candidate.venue, hasPdf: Boolean(row.candidate.pdfUrl) }
      : null,
  };
}

async function loadEntry(sql: postgres.Sql, sessionId: string, runId: string, entryId: string): Promise<Row> {
  assertId(runId);
  assertId(entryId);
  const [row] = await sql<Row[]>`
    select id, position, raw_text, document_id, source_state, ref_type, candidate
    from reference_entries where id = ${entryId} and run_id = ${runId} and session_id = ${sessionId}`;
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  return row;
}

export async function listReferencesHandler(context: ApiContext, runId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  assertId(runId);
  const rows = await sql<Row[]>`
    select id, position, raw_text, document_id, source_state, ref_type, candidate
    from reference_entries where run_id = ${runId} and session_id = ${context.sessionId} order by position`;
  return jsonResponse({ references: rows.map(toView) });
}

export async function discoverEntryHandler(context: ApiContext, runId: string, entryId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  const entry = await loadEntry(sql, sessionId, runId, entryId);
  // Looked at once: a second press returns what was saved.
  if (entry.document_id || entry.source_state !== "pending") return jsonResponse({ reference: toView(entry) });

  const resolve = context.deps.resolve ?? ((raw: string) => resolveReference(raw));
  const fetchImpl = context.deps.fetch;
  const fetchFn: FetchFn = fetchImpl ? (url, init) => fetchImpl(url, { headers: init?.headers ?? {} }) : defaultFetch;
  const outcome = await discoverReference(entry.raw_text, {
    resolve: (raw) => resolveEntryCached(sql, { entryId, sessionId, raw, resolve }),
    fetch: fetchFn,
    openAlexApiKey: process.env.OPENALEX_API_KEY,
  });
  // A failed lookup saves nothing, so the browser can try again.
  if (outcome.state === "error") throw new ApiError(503, "lookup_failed", "The lookup did not answer. Try again.");

  const state: SourceState =
    outcome.state === "matched" ? (outcome.candidate.pdfUrl ? "matched" : "matched_no_file") : outcome.state === "possible" ? "possible" : "not_retrieved";
  const candidate = outcome.state === "none" ? null : outcome.candidate;
  const [saved] = await sql<Row[]>`
    update reference_entries
    set source_state = ${state}, ref_type = ${outcome.type}, candidate = ${candidate ? sql.json(candidate as never) : null}
    where id = ${entryId} and session_id = ${sessionId} and source_state = 'pending'
    returning id, position, raw_text, document_id, source_state, ref_type, candidate`;
  return jsonResponse({ reference: toView(saved ?? (await loadEntry(sql, sessionId, runId, entryId))) });
}

export async function retrieveEntryHandler(context: ApiContext, runId: string, entryId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  const entry = await loadEntry(sql, sessionId, runId, entryId);
  if (entry.source_state !== "matched" || !entry.candidate?.pdfUrl) throw new ApiError(409, "not_matched", "This reference has no matched source to retrieve.");

  let bytes: Uint8Array;
  try {
    bytes = await (context.deps.fetchPdf ?? fetchPdf)(entry.candidate.pdfUrl);
  } catch (error) {
    if (!(error instanceof PdfFetchError)) throw error;
    // The link did not give a PDF (a landing page, a block, a timeout). The match stands; the student uploads the file.
    const [kept] = await sql<Row[]>`
      update reference_entries set source_state = 'matched_no_file'
      where id = ${entryId} and session_id = ${sessionId} and source_state = 'matched'
      returning id, position, raw_text, document_id, source_state, ref_type, candidate`;
    return jsonResponse({ reference: toView(kept ?? entry), document: null });
  }

  // The same PDF already in the session is reused, so it takes no second source slot.
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const [same] = await sql<{ id: string; filename: string; status: string; page_count: number | null }[]>`
    select id, filename, status, page_count from documents where session_id = ${sessionId} and content_hash = ${contentHash}`;
  let document: { documentId: string; filename: string; status: string; pageCount: number };
  if (same) {
    document = { documentId: same.id, filename: same.filename, status: same.status, pageCount: same.page_count ?? 0 };
  } else {
    const filename = `${referenceTitle(entry.raw_text).slice(0, 100)}.pdf`;
    let created;
    try {
      created = await createDocumentFromPdf(sql, { sessionId, filename, bytes });
    } catch (error) {
      if (error instanceof IngestError && error.code === "too_many_documents") {
        throw new ApiError(409, "too_many_documents", "You have reached the limit of sources for one check. Remove one to add another.");
      }
      throw error;
    }
    await sql`update documents set content_hash = ${contentHash} where id = ${created.documentId}`;
    document = { documentId: created.documentId, filename, status: created.status, pageCount: created.pageCount };
  }

  const [saved] = await sql<Row[]>`
    update reference_entries set document_id = ${document.documentId}, source_state = 'retrieved'
    where id = ${entryId} and session_id = ${sessionId}
    returning id, position, raw_text, document_id, source_state, ref_type, candidate`;
  await logEvent(sql, sessionId, "source_attached", { how: "open_access" });
  return jsonResponse({ reference: toView(saved!), document }, 201);
}

const confirmBody = z.object({ accept: z.boolean() });

export async function confirmEntryHandler(context: ApiContext, runId: string, entryId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  const { accept } = confirmBody.parse(await readJson(request));
  const entry = await loadEntry(sql, sessionId, runId, entryId);
  if (entry.source_state !== "possible") throw new ApiError(409, "not_possible", "There is no possible match to answer.");
  const next: SourceState = accept ? (entry.candidate?.pdfUrl ? "matched" : "matched_no_file") : "not_retrieved";
  const [saved] = await sql<Row[]>`
    update reference_entries
    set source_state = ${next}, candidate = ${accept ? sql.json(entry.candidate as never) : null}
    where id = ${entryId} and session_id = ${sessionId} and source_state = 'possible'
    returning id, position, raw_text, document_id, source_state, ref_type, candidate`;
  return jsonResponse({ reference: toView(saved ?? entry) });
}

const linkBody = z.object({ documentId: z.string() });

export async function linkEntryHandler(context: ApiContext, runId: string, entryId: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  const { documentId } = linkBody.parse(await readJson(request));
  assertId(documentId);
  await loadEntry(sql, sessionId, runId, entryId);
  const [doc] = await sql<{ id: string }[]>`select id from documents where id = ${documentId} and session_id = ${sessionId}`;
  if (!doc) throw new ApiError(404, "not_found", "Not found.");
  const [saved] = await sql<Row[]>`
    update reference_entries set document_id = ${documentId}, source_state = 'uploaded'
    where id = ${entryId} and session_id = ${sessionId}
    returning id, position, raw_text, document_id, source_state, ref_type, candidate`;
  return jsonResponse({ reference: toView(saved!) });
}
