// Stage 5: ingest a source PDF, once per PDF.
//
// Request model (docs/architecture.md): no request runs long and there is no file store.
//   1. createDocumentFromPdf: the PDF arrives in one request. Its text is read page by page, normalized
//      and saved to `pages`. The PDF bytes are never stored, so there is nothing to delete afterwards.
//   2. ingestNextBatch: called repeatedly by the browser. Each call chunks the next few saved pages,
//      embeds them and saves the chunks, in one transaction.
//
// All-or-nothing: a document stays 'ingesting' (and invisible to retrieval, which reads only 'ready')
// until the last batch flips it to 'ready' in the same transaction that saves its last chunks. A batch
// that fails writes nothing and can simply be retried. abandonDocument removes a document for good
// (its pages and chunks go with it). A PDF with no extractable text (a scan; there is no OCR) becomes
// 'no_text' straight away, and a claim that needs it exits as Can't check.
import { extractText, getDocumentProxy } from "unpdf";
import type postgres from "postgres";
import { atomically } from "../db-tx";
import type { Llm } from "../llm/adapter";
import { chunkPages, hasExtractableText, type PageText } from "../rag/chunker";
import { embedChunks, toVectorLiteral } from "../rag/embed";
import { normalizeText } from "../rag/normalize";
import type { SqlLike } from "../rag/retrieve";

/** Starting values. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const MAX_DOCUMENTS_PER_SESSION = 10;
/** Pages per ingest request. About a dozen chunks, so one embedding call and well under 10 seconds. */
export const INGEST_BATCH_PAGES = 10;
const MAX_FILENAME_CHARS = 200;

export type IngestErrorCode =
  | "too_large"
  | "not_a_pdf"
  | "unreadable"
  | "too_many_pages"
  | "too_many_documents"
  | "not_found";

export class IngestError extends Error {
  override name = "IngestError";
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ExtractOptions {
  maxBytes?: number;
  maxPages?: number;
}

/** Reads a PDF into normalized text per page. Empty pages give empty text. The input is not modified. */
export async function extractPdfPages(bytes: Uint8Array, options: ExtractOptions = {}): Promise<PageText[]> {
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;

  if (bytes.byteLength > maxBytes) {
    throw new IngestError("too_large", `The PDF is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new IngestError("not_a_pdf", "The file is not a PDF.");

  // PDF.js may take ownership of the buffer it is given, so it gets a copy.
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new IngestError("unreadable", "The PDF could not be read. It may be damaged or password-protected.");
  }

  try {
    if (pdf.numPages > maxPages) {
      throw new IngestError("too_many_pages", `The PDF has more than ${maxPages} pages.`);
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((pageText, index) => ({ pageNumber: index + 1, text: normalizeText(pageText) }));
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError("unreadable", "The text of the PDF could not be read.");
  } finally {
    // The loading task owns the document and its resources; destroying it frees them.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

export interface CreateDocumentArgs {
  sessionId: string;
  filename: string;
  bytes: Uint8Array;
}

export interface CreatedDocument {
  documentId: string;
  /** 'ingesting' means call ingestNextBatch until done; 'no_text' means a scan with nothing to ingest. */
  status: "ingesting" | "no_text";
  pageCount: number;
}

function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_FILENAME_CHARS);
  return cleaned.length > 0 ? cleaned : "source.pdf";
}

export async function createDocumentFromPdf(db: SqlLike, args: CreateDocumentArgs): Promise<CreatedDocument> {
  const sql = db as postgres.Sql;

  const [existing] = await sql<{ count: number }[]>`
    select count(*)::int as count from documents where session_id = ${args.sessionId}`;
  if ((existing?.count ?? 0) >= MAX_DOCUMENTS_PER_SESSION) {
    throw new IngestError("too_many_documents", `A session can hold at most ${MAX_DOCUMENTS_PER_SESSION} sources.`);
  }

  const pages = await extractPdfPages(args.bytes);
  const filename = cleanFilename(args.filename);

  if (!hasExtractableText(pages)) {
    const [doc] = await sql<{ id: string }[]>`
      insert into documents (session_id, filename, page_count, status)
      values (${args.sessionId}, ${filename}, ${pages.length}, 'no_text') returning id`;
    return { documentId: doc!.id, status: "no_text", pageCount: pages.length };
  }

  return atomically(sql)(async (tx) => {
    const [doc] = await tx<{ id: string }[]>`
      insert into documents (session_id, filename, page_count, status)
      values (${args.sessionId}, ${filename}, ${pages.length}, 'ingesting') returning id`;
    await tx`
      insert into pages (document_id, page_number, text)
      select ${doc!.id}::uuid, p.n, p.t
      from unnest(${pages.map((p) => p.pageNumber)}::int[], ${pages.map((p) => p.text)}::text[]) as p(n, t)`;
    return { documentId: doc!.id, status: "ingesting" as const, pageCount: pages.length };
  });
}

export interface IngestProgress {
  documentId: string;
  status: "ingesting" | "ready" | "no_text" | "failed";
  pagesIngested: number;
  pageCount: number;
  /** True once the document is no longer 'ingesting' (ready, no_text or failed). */
  done: boolean;
}

interface DocRow {
  id: string;
  status: IngestProgress["status"];
  page_count: number;
  pages_ingested: number;
}

function progressOf(doc: DocRow): IngestProgress {
  return {
    documentId: doc.id,
    status: doc.status,
    pagesIngested: doc.pages_ingested,
    pageCount: doc.page_count,
    done: doc.status !== "ingesting",
  };
}

export interface IngestBatchArgs {
  sessionId: string;
  documentId: string;
  batchPages?: number;
}

/**
 * Chunks, embeds and saves the next batch of pages. Safe to call again after any failure, and safe if
 * two calls overlap: the second finds the document has moved on and writes nothing.
 */
export async function ingestNextBatch(db: SqlLike, llm: Llm, args: IngestBatchArgs): Promise<IngestProgress> {
  const sql = db as postgres.Sql;
  const batchPages = args.batchPages ?? INGEST_BATCH_PAGES;

  const [doc] = await sql<DocRow[]>`
    select id, status, page_count, pages_ingested from documents
    where id = ${args.documentId} and session_id = ${args.sessionId}`;
  if (!doc) throw new IngestError("not_found", "Source not found.");
  if (doc.status !== "ingesting") return progressOf(doc);

  const start = doc.pages_ingested;
  const pageRows = await sql<{ page_number: number; text: string }[]>`
    select page_number, text from pages
    where document_id = ${doc.id} and page_number > ${start} and page_number <= ${start + batchPages}
    order by page_number`;

  // Embedding is a network call, so it happens outside the transaction.
  const chunks = chunkPages(pageRows.map((row) => ({ pageNumber: row.page_number, text: row.text })));
  const embedded = await embedChunks(llm, chunks);

  return atomically(sql)(async (tx) => {
    const [locked] = await tx<DocRow[]>`
      select id, status, page_count, pages_ingested from documents where id = ${doc.id} for update`;
    if (!locked || locked.status !== "ingesting" || locked.pages_ingested !== start) {
      return progressOf(locked ?? doc); // another request already did this batch
    }

    if (embedded.length > 0) {
      const [offset] = await tx<{ next: number }[]>`
        select coalesce(max(chunk_index) + 1, 0)::int as next from chunks where document_id = ${doc.id}`;
      const first = offset?.next ?? 0;
      await tx`
        insert into chunks (document_id, chunk_index, page_number, content, embedding)
        select ${doc.id}::uuid, c.idx, c.pg, c.txt, c.emb::vector
        from unnest(
          ${embedded.map((_, i) => first + i)}::int[],
          ${embedded.map((chunk) => chunk.pageNumber)}::int[],
          ${embedded.map((chunk) => chunk.content)}::text[],
          ${embedded.map((chunk) => toVectorLiteral(chunk.embedding))}::text[]
        ) as c(idx, pg, txt, emb)`;
    }

    const pagesIngested = start + pageRows.length;
    let status: IngestProgress["status"] = "ingesting";
    if (pagesIngested >= locked.page_count) {
      const [total] = await tx<{ n: number }[]>`select count(*)::int as n from chunks where document_id = ${doc.id}`;
      status = (total?.n ?? 0) > 0 ? "ready" : "no_text";
    }
    await tx`update documents set pages_ingested = ${pagesIngested}, status = ${status} where id = ${doc.id}`;

    return progressOf({ ...locked, pages_ingested: pagesIngested, status });
  });
}

/** Removes a document and, by cascade, its pages and chunks. Used when a batch keeps failing. */
export async function abandonDocument(db: SqlLike, args: { sessionId: string; documentId: string }): Promise<boolean> {
  const sql = db as postgres.Sql;
  const rows = await sql<{ id: string }[]>`
    delete from documents where id = ${args.documentId} and session_id = ${args.sessionId} returning id`;
  return rows.length > 0;
}
