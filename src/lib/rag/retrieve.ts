// Hybrid retrieval (stage 6): pgvector cosine similarity plus Postgres full-text search, merged by
// reciprocal rank fusion (RRF), top 5 returned with their page numbers.
//
// - Reads are scoped to one session and to documents whose status is 'ready', so an unfinished or
//   failed ingest is never searched and nobody sees another session's sources.
// - The full-text arm uses the 'simple' config (no stemming) because sources mix English and Bahasa
//   Indonesia, and ORs the claim's content words, since a whole sentence rarely matches as an AND.
// - No similarity threshold yet: deciding "not in sources" is the judge's job. Tune on the eval set.
// - Ties are broken by upload order and chunk position, never by a random id. Chunk ids are new on every
//   ingest, so an id tie-break reordered (and, at rank 5, changed) the passages between identical runs, which
//   changed the judge's verdict for the same claim.
import type postgres from "postgres";
import { toVectorLiteral } from "./embed";

export const RETRIEVAL_LIMIT = 5;
/** Candidates taken from each arm before fusion. */
const CANDIDATES_PER_ARM = 20;
/** The usual RRF constant. A starting value. */
const RRF_K = 60;
const MAX_QUERY_TERMS = 30;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  /** Fused RRF score. Higher is better. */
  score: number;
  /** 1-based rank in the vector arm, or null if it was not among that arm's candidates. */
  vectorRank: number | null;
  /** 1-based rank in the full-text arm, or null if no query word matched. */
  textRank: number | null;
}

export interface RetrieveArgs {
  sessionId: string;
  queryEmbedding: number[];
  queryText: string;
  /** Limit the search to these documents. Omit to search every ready document in the session. */
  documentIds?: string[];
  limit?: number;
}

const STOPWORDS = new Set([
  // English
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "in", "is",
  "it", "its", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "which", "with",
  "not", "no", "than", "then", "there", "these", "those", "had", "been", "also", "into",
  // Bahasa Indonesia
  "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "ini", "itu", "adalah", "akan",
  "juga", "atau", "oleh", "dalam", "sebagai", "karena", "tidak", "telah", "dapat", "bahwa", "para",
  "serta", "lebih", "sudah", "ada", "mereka", "kami", "kita", "saya", "anda", "dia", "nya",
]);

/**
 * Turns free text into an OR query for to_tsquery('simple', ...). Only letters and digits survive,
 * so the result can never contain tsquery operators. Returns "" when no content words remain.
 */
export function buildTsQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    const isNumber = /^\p{N}+$/u.test(word);
    if (!isNumber && word.length < 2) continue;
    if (STOPWORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length >= MAX_QUERY_TERMS) break;
  }
  return terms.join(" | ");
}

interface Row {
  chunk_id: string;
  document_id: string;
  page_number: number;
  chunk_index: number;
  content: string;
  score: number;
  vector_rank: number | null;
  text_rank: number | null;
}

/** A pool or a transaction handle. At runtime both are the same callable template tag. */
export type SqlLike = postgres.Sql | postgres.TransactionSql;

export async function retrieveTopChunks(
  db: SqlLike,
  args: RetrieveArgs,
): Promise<RetrievedChunk[]> {
  const sql = db as postgres.Sql;
  const limit = args.limit ?? RETRIEVAL_LIMIT;
  const vector = toVectorLiteral(args.queryEmbedding);
  const tsQuery = buildTsQuery(args.queryText);
  const docFilter = args.documentIds
    ? sql`and c.document_id::text = any(${args.documentIds})`
    : sql``;

  const rows = await sql<Row[]>`
    with vec as (
      select c.id,
             row_number() over (order by c.embedding <=> ${vector}::vector, d.created_at, c.chunk_index, c.id)::int as rnk
      from chunks c
      join documents d on d.id = c.document_id
      where d.session_id = ${args.sessionId} and d.status = 'ready' ${docFilter}
      order by c.embedding <=> ${vector}::vector, d.created_at, c.chunk_index, c.id
      limit ${CANDIDATES_PER_ARM}
    ),
    txt as (
      select c.id,
             row_number() over (
               order by ts_rank_cd(c.fts, q.query) desc, d.created_at, c.chunk_index, c.id
             )::int as rnk
      from chunks c
      join documents d on d.id = c.document_id
      cross join (select to_tsquery('simple', ${tsQuery}) as query) q
      where d.session_id = ${args.sessionId} and d.status = 'ready' ${docFilter}
        and c.fts @@ q.query
      order by ts_rank_cd(c.fts, q.query) desc, d.created_at, c.chunk_index, c.id
      limit ${CANDIDATES_PER_ARM}
    )
    select c.id as chunk_id,
           c.document_id,
           c.page_number,
           c.chunk_index,
           c.content,
           (coalesce(1.0 / (${RRF_K}::int + vec.rnk), 0)
             + coalesce(1.0 / (${RRF_K}::int + txt.rnk), 0))::float8 as score,
           vec.rnk as vector_rank,
           txt.rnk as text_rank
    from vec
    full join txt on txt.id = vec.id
    join chunks c on c.id = coalesce(vec.id, txt.id)
    join documents dd on dd.id = c.document_id
    order by score desc, dd.created_at, c.chunk_index, c.id
    limit ${limit}
  `;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: row.score,
    vectorRank: row.vector_rank,
    textRank: row.text_rank,
  }));
}
