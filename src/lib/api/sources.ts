// Source handlers: upload a PDF, ingest it in page batches, list and delete.
//
//   POST   /api/sources              upload a PDF (multipart "file"); saves its page text, never the file
//   POST   /api/sources/:id/ingest   chunk, embed and save the next batch of pages; the browser repeats until done
//   GET    /api/sources              the session's sources and their state
//   DELETE /api/sources/:id          remove a source with its pages and chunks
import type postgres from "postgres";
import { logEvent, pageBucket } from "../events";
import { MAX_PDF_BYTES, abandonDocument, createDocumentFromPdf, ingestNextBatch } from "../pipeline/ingest";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readUpload } from "./http";

export async function uploadSource(context: ApiContext, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const upload = await readUpload(request, "file", MAX_PDF_BYTES);
  const created = await createDocumentFromPdf(sql, {
    sessionId: context.sessionId,
    filename: upload.filename,
    bytes: upload.bytes,
  });
  if (created.status === "no_text") {
    await logEvent(sql, context.sessionId, "source_uploaded", { page_bucket: pageBucket(created.pageCount), ingest_ms: 0 });
  }
  return jsonResponse({ documentId: created.documentId, status: created.status, pageCount: created.pageCount }, 201);
}

export async function ingestSource(context: ApiContext, documentId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  assertId(documentId);
  const result = await ingestNextBatch(sql, context.deps.llm, { sessionId: context.sessionId, documentId });

  if (result.completedNow && result.status === "ready") {
    const [timing] = await sql<{ ms: number }[]>`
      select (extract(epoch from (now() - created_at)) * 1000)::int as ms from documents where id = ${documentId}`;
    await logEvent(sql, context.sessionId, "source_uploaded", {
      page_bucket: pageBucket(result.pageCount),
      ingest_ms: Math.max(0, timing?.ms ?? 0),
    });
  }

  return jsonResponse({
    documentId: result.documentId,
    status: result.status,
    pagesIngested: result.pagesIngested,
    pageCount: result.pageCount,
    done: result.done,
  });
}

export async function listSources(context: ApiContext): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const rows = await sql<
    { id: string; filename: string; status: string; page_count: number | null; pages_ingested: number; created_at: Date }[]
  >`
    select id, filename, status, page_count, pages_ingested, created_at from documents
    where session_id = ${context.sessionId} order by created_at, id`;
  return jsonResponse({
    sources: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      status: row.status,
      pageCount: row.page_count,
      pagesIngested: row.pages_ingested,
      createdAt: row.created_at,
    })),
  });
}

export async function deleteSource(context: ApiContext, documentId: string): Promise<Response> {
  assertId(documentId);
  const removed = await abandonDocument(context.deps.sql, { sessionId: context.sessionId, documentId });
  if (!removed) throw new ApiError(404, "not_found", "Not found.");
  return new Response(null, { status: 204 });
}
