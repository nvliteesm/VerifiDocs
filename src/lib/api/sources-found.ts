// POST /api/claims/:id/sources: Find a source (docs/source-discovery.md, phase 1).
//
// Only for a claim whose verdict is No citation. The search runs once per claim: a second press returns what was
// saved, with no model call, including "nothing found". A failed search (OpenAlex down or out of time) saves
// nothing and asks the browser to retry. The event carries a count, a time and the outcome, never the claim, the
// queries or a title (hard rule 11).
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { inTextCitation, referenceEntry } from "../client/cite";
import { atomically } from "../db-tx";
import { logEvent } from "../events";
import type { FoundSource } from "../pipeline/discover-sources";
import { PdfFetchError, fetchPdf } from "../pipeline/fetch-pdf";
import { MAX_PDF_BYTES, createDocumentFromPdf } from "../pipeline/ingest";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readUpload } from "./http";

export interface FoundSourceView {
  rank: number;
  openalexId: string;
  doi: string | null;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  openAccessPdf: string | null;
  sentence: string;
  relevance: "direct" | "related";
}

interface SourceRow {
  claim_id: string;
  rank: number;
  openalex_id: string;
  doi: string | null;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  open_access_pdf: string | null;
  sentence: string;
  relevance: "direct" | "related";
}

export function toSourceView(row: SourceRow): FoundSourceView {
  return {
    rank: row.rank,
    openalexId: row.openalex_id,
    doi: row.doi,
    title: row.title,
    year: row.year,
    authors: row.authors,
    venue: row.venue,
    openAccessPdf: row.open_access_pdf,
    sentence: row.sentence,
    relevance: row.relevance,
  };
}

/** The saved papers of every claim in a run, by claim id, best first. */
export async function sourcesForRun(sql: postgres.Sql, runId: string): Promise<Map<string, FoundSourceView[]>> {
  const rows = await sql<SourceRow[]>`
    select s.claim_id, s.rank, s.openalex_id, s.doi, s.title, s.year, s.authors, s.venue, s.open_access_pdf,
           s.sentence, s.relevance
    from claim_sources s join claims c on c.id = s.claim_id
    where c.run_id = ${runId} order by s.claim_id, s.rank`;
  const byClaim = new Map<string, FoundSourceView[]>();
  for (const row of rows) byClaim.set(row.claim_id, [...(byClaim.get(row.claim_id) ?? []), toSourceView(row)]);
  return byClaim;
}

export async function findSourcesHandler(context: ApiContext, claimId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  assertId(claimId);

  const [claim] = await sql<{ id: string; text: string; verdict: string | null; searched: boolean }[]>`
    select c.id, c.text, v.verdict, c.sources_searched_at is not null as searched
    from claims c left join verdicts v on v.claim_id = c.id
    where c.id = ${claimId} and c.session_id = ${sessionId}`;
  if (!claim) throw new ApiError(404, "not_found", "Not found.");
  if (claim.verdict !== "no_citation_given") {
    throw new ApiError(409, "not_uncited", "Find a source is only for a claim with no citation.");
  }

  const saved = async (reader: postgres.Sql) => {
    const rows = await reader<SourceRow[]>`
      select claim_id, rank, openalex_id, doi, title, year, authors, venue, open_access_pdf, sentence, relevance
      from claim_sources where claim_id = ${claimId} order by rank`;
    return jsonResponse({ claimId, sources: rows.map(toSourceView) });
  };
  if (claim.searched) return saved(sql);

  const discover = context.deps.discover;
  if (!discover) throw new Error("No source search is configured.");
  const started = (context.deps.now ?? Date.now)();
  // The model and OpenAlex calls are outside the transaction: they are network calls.
  const result = await discover(claim.text);
  const latency = Math.max(0, Math.round((context.deps.now ?? Date.now)() - started));

  if (result.exit === "search_failed") {
    return jsonResponse(
      { error: { code: "search_busy", message: "The paper search is busy. Try again in a moment.", retry: true } },
      503,
      { "retry-after": "2" },
    );
  }

  return atomically(sql)(async (tx) => {
    // Another press finished first while this one searched: keep its result.
    const marked = await tx<{ id: string }[]>`
      update claims set sources_searched_at = now()
      where id = ${claimId} and sources_searched_at is null returning id`;
    if (marked.length === 0) return saved(tx);

    const sources: FoundSource[] = result.sources;
    // At most three rows, so one insert each keeps the author list a plain text array.
    for (const [index, source] of sources.entries()) {
      await tx`
        insert into claim_sources (claim_id, session_id, rank, openalex_id, doi, title, year, authors, venue,
                                   open_access_pdf, sentence, relevance)
        values (${claimId}, ${sessionId}, ${index + 1}, ${source.openalexId}, ${source.doi}, ${source.title},
                ${source.year}, ${source.authors}::text[], ${source.venue}, ${source.openAccessPdf}, ${source.sentence},
                ${source.relevance})`;
    }
    await logEvent(tx, sessionId, "sources_suggested", {
      count: sources.length,
      latency_ms: latency,
      outcome: result.exit === "found" ? "found" : "nothing_relevant",
    });
    return saved(tx);
  });
}

// ---- Attach: check the claim against a found paper (phase 2, step 5) --------------------------------------------

/**
 * Gets the paper's PDF (fetched from its open-access link under the safe-fetch rules, or uploaded by the student),
 * makes it a source document, and in one transaction links it to the claim: a reference entry for the run pointing
 * at the document, the claim's citation set to the in-text marker with citation_source 'found', its No citation
 * verdict removed (a saved verdict is never overwritten), and the run reopened. The browser then reads the document
 * in the usual batches and runs the normal check. The PDF itself is never stored (hard rule 4).
 */
export async function attachSourceHandler(context: ApiContext, claimId: string, rankText: string, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  assertId(claimId);
  const rank = Number(rankText);
  if (!Number.isInteger(rank) || rank < 1 || rank > 3) throw new ApiError(404, "not_found", "Not found.");

  const [claim] = await sql<{ id: string; run_id: string; verdict: string | null; citation_source: string }[]>`
    select c.id, c.run_id, v.verdict, c.citation_source
    from claims c left join verdicts v on v.claim_id = c.id
    where c.id = ${claimId} and c.session_id = ${sessionId}`;
  if (!claim) throw new ApiError(404, "not_found", "Not found.");
  const [found] = await sql<SourceRow[]>`
    select claim_id, rank, openalex_id, doi, title, year, authors, venue, open_access_pdf, sentence, relevance
    from claim_sources where claim_id = ${claimId} and rank = ${rank}`;
  if (!found) throw new ApiError(404, "not_found", "Not found.");
  if (claim.verdict !== "no_citation_given" || claim.citation_source !== "draft") {
    throw new ApiError(409, "already_cited", "This claim already has a citation.");
  }

  // The paper's PDF: the student's upload, or the open-access link fetched under the safe-fetch rules.
  let bytes: Uint8Array;
  let how: "open_access" | "upload";
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    bytes = (await readUpload(request, "file", MAX_PDF_BYTES)).bytes;
    how = "upload";
  } else {
    if (!found.open_access_pdf) throw new ApiError(422, "no_open_access", "This paper has no free PDF. Upload its PDF instead.");
    try {
      bytes = await (context.deps.fetchPdf ?? fetchPdf)(found.open_access_pdf);
    } catch (error) {
      if (error instanceof PdfFetchError) throw new ApiError(422, "fetch_failed", "This paper could not be downloaded. Upload its PDF instead.");
      throw error;
    }
    how = "open_access";
  }

  // The same PDF already in the session is reused, so attaching it to a second claim takes no extra source slot.
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const [same] = await sql<{ id: string; status: string; page_count: number | null }[]>`
    select id, status, page_count from documents where session_id = ${sessionId} and content_hash = ${contentHash}`;
  let document: { documentId: string; status: string; pageCount: number };
  if (same) {
    document = { documentId: same.id, status: same.status, pageCount: same.page_count ?? 0 };
  } else {
    const created = await createDocumentFromPdf(sql, { sessionId, filename: `${found.title.slice(0, 100)}.pdf`, bytes });
    await sql`update documents set content_hash = ${contentHash} where id = ${created.documentId}`;
    document = created;
  }

  const paper = toSourceView(found);
  await atomically(sql)(async (tx) => {
    const [next] = await tx<{ n: number }[]>`
      select coalesce(max(position), 0)::int + 1 as n from reference_entries where run_id = ${claim.run_id}`;
    await tx`
      insert into reference_entries (run_id, session_id, raw_text, position, document_id)
      values (${claim.run_id}, ${sessionId}, ${referenceEntry(paper)}, ${next!.n}, ${document.documentId})`;
    const changed = await tx`
      update claims set citation_text = ${inTextCitation(paper)}, citation_inherited = false, citation_source = 'found',
                        status = 'pending', attempts = 0
      where id = ${claimId} and citation_source = 'draft'`;
    if (changed.count === 0) throw new ApiError(409, "already_cited", "This claim already has a citation.");
    await tx`delete from verdicts where claim_id = ${claimId} and verdict = 'no_citation_given'`;
    await tx`update runs set status = 'checking', completed_at = null where id = ${claim.run_id} and status = 'completed'`;
    await logEvent(tx, sessionId, "source_attached", { how });
  });

  return jsonResponse({ claimId, documentId: document.documentId, status: document.status, pageCount: document.pageCount }, 201);
}
