// POST /api/claims/:id/sources: Find a source (docs/source-discovery.md, phase 1).
//
// Only for a claim whose verdict is No citation. The search runs once per claim: a second press returns what was
// saved, with no model call, including "nothing found". A failed search (OpenAlex down or out of time) saves
// nothing and asks the browser to retry. The event carries a count, a time and the outcome, never the claim, the
// queries or a title (hard rule 11).
import type postgres from "postgres";
import { atomically } from "../db-tx";
import { logEvent } from "../events";
import type { FoundSource } from "../pipeline/discover-sources";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse } from "./http";

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
