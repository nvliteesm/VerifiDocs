// POST /api/claims/:id/web-sources: Search the web (docs/web-sources.md, phase 2).
//
// Only for a claim with no citation whose paper search (Find a source) already ran and found nothing: the web is the
// second step, and its own request, so each request stays short (hard rule 6). The search runs once per claim: a
// second press returns what was saved, with no model or search call, including "nothing found". A service failure
// (busy, out of credits, not set up) saves nothing and is reported, never shown as "nothing found". The event carries
// a count, a time and the outcome, never the claim, the queries, a title or an address (hard rule 11).
import type postgres from "postgres";
import { atomically } from "../db-tx";
import { logEvent } from "../events";
import type { WebSource } from "../pipeline/discover-web";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse } from "./http";

export interface WebSourceView {
  rank: number;
  url: string;
  site: string;
  title: string;
  sentence: string;
  relevance: "direct" | "related";
  /** When the page was found, as an ISO date-time. The reference format needs the day it was retrieved. */
  retrievedAt: string;
}

interface WebRow {
  claim_id: string;
  rank: number;
  url: string;
  site: string;
  title: string;
  sentence: string;
  relevance: "direct" | "related";
  retrieved_at: Date;
}

export function toWebView(row: WebRow): WebSourceView {
  return {
    rank: row.rank,
    url: row.url,
    site: row.site,
    title: row.title,
    sentence: row.sentence,
    relevance: row.relevance,
    retrievedAt: new Date(row.retrieved_at).toISOString(),
  };
}

/** The saved web pages of every claim in a run, by claim id, best first. */
export async function webSourcesForRun(sql: postgres.Sql, runId: string): Promise<Map<string, WebSourceView[]>> {
  const rows = await sql<WebRow[]>`
    select s.claim_id, s.rank, s.url, s.site, s.title, s.sentence, s.relevance, s.retrieved_at
    from claim_web_sources s join claims c on c.id = s.claim_id
    where c.run_id = ${runId} order by s.claim_id, s.rank`;
  const byClaim = new Map<string, WebSourceView[]>();
  for (const row of rows) byClaim.set(row.claim_id, [...(byClaim.get(row.claim_id) ?? []), toWebView(row)]);
  return byClaim;
}

export async function findWebSourcesHandler(context: ApiContext, claimId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  const { sessionId } = context;
  assertId(claimId);

  const [claim] = await sql<
    { id: string; text: string; verdict: string | null; papers_searched: boolean; web_searched: boolean; papers: number }[]
  >`
    select c.id, c.text, v.verdict,
           c.sources_searched_at is not null as papers_searched,
           c.web_searched_at is not null as web_searched,
           (select count(*)::int from claim_sources s where s.claim_id = c.id) as papers
    from claims c left join verdicts v on v.claim_id = c.id
    where c.id = ${claimId} and c.session_id = ${sessionId}`;
  if (!claim) throw new ApiError(404, "not_found", "Not found.");
  if (claim.verdict !== "no_citation_given") {
    throw new ApiError(409, "not_uncited", "Search the web is only for a claim with no citation.");
  }
  if (!claim.papers_searched || claim.papers > 0) {
    throw new ApiError(409, "papers_first", "Search the web is only for a claim where Find a source found no paper.");
  }

  const saved = async (reader: postgres.Sql) => {
    const rows = await reader<WebRow[]>`
      select claim_id, rank, url, site, title, sentence, relevance, retrieved_at
      from claim_web_sources where claim_id = ${claimId} order by rank`;
    return jsonResponse({ claimId, sources: rows.map(toWebView) });
  };
  if (claim.web_searched) return saved(sql);

  const discoverWeb = context.deps.discoverWeb;
  if (!discoverWeb) throw new ApiError(404, "web_search_off", "Web search is not set up.");
  const started = (context.deps.now ?? Date.now)();
  // The model and search calls are outside the transaction: they are network calls. A failure throws and saves nothing.
  const result = await discoverWeb(claim.text);
  const latency = Math.max(0, Math.round((context.deps.now ?? Date.now)() - started));

  return atomically(sql)(async (tx) => {
    // Another press finished first while this one searched: keep its result.
    const marked = await tx<{ id: string }[]>`
      update claims set web_searched_at = now() where id = ${claimId} and web_searched_at is null returning id`;
    if (marked.length === 0) return saved(tx);

    const sources: WebSource[] = result.sources;
    for (const [index, source] of sources.entries()) {
      await tx`
        insert into claim_web_sources (claim_id, session_id, rank, url, site, title, sentence, relevance)
        values (${claimId}, ${sessionId}, ${index + 1}, ${source.url}, ${source.site}, ${source.title}, ${source.sentence}, ${source.relevance})`;
    }
    await logEvent(tx, sessionId, "web_sources_suggested", {
      count: sources.length,
      latency_ms: latency,
      outcome: result.exit === "found" ? "found" : "nothing_relevant",
    });
    return saved(tx);
  });
}
