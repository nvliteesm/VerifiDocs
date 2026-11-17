// Looks a reference-list entry up once per run. The result is saved on the reference_entries row, so
// several claims that cite the same reference make one Crossref/OpenAlex lookup, not one each.
//
// - Only definite answers are cached: "found" and "not_found". A failed lookup ("error") is never saved,
//   so the next attempt tries again.
// - Reads and writes are scoped to the session.
// - Two claims checked at the same moment may both look the entry up; the write only applies while the
//   row is still 'pending', so the first answer wins and nothing is overwritten.
import type postgres from "postgres";
import type { SqlLike } from "../rag/retrieve";
import type { ReferenceResolution } from "./resolve-reference";

export interface ResolveEntryArgs {
  entryId: string;
  sessionId: string;
  /** The entry's text, as it will be sent to Crossref and OpenAlex. */
  raw: string;
  resolve: (raw: string) => Promise<ReferenceResolution>;
}

interface Row {
  resolution: "pending" | "found" | "not_found";
  resolver: "crossref" | "openalex" | null;
  resolved_doi: string | null;
  resolved_title: string | null;
  resolved_year: number | null;
  year_mismatch: boolean;
}

export async function resolveEntryCached(db: SqlLike, args: ResolveEntryArgs): Promise<ReferenceResolution> {
  const sql = db as postgres.Sql;

  const [row] = await sql<Row[]>`
    select resolution, resolver, resolved_doi, resolved_title, resolved_year, year_mismatch
    from reference_entries
    where id = ${args.entryId} and session_id = ${args.sessionId}`;
  if (!row) throw new Error("Reference entry not found for this session.");

  if (row.resolution === "not_found") return { status: "not_found" };
  if (row.resolution === "found" && row.resolver && row.resolved_title) {
    return {
      status: "found",
      resolver: row.resolver,
      doi: row.resolved_doi,
      title: row.resolved_title,
      year: row.resolved_year,
      yearMismatch: row.year_mismatch,
    };
  }

  const result = await args.resolve(args.raw);

  if (result.status === "found") {
    await sql`
      update reference_entries
      set resolution = 'found', resolver = ${result.resolver}, resolved_doi = ${result.doi},
          resolved_title = ${result.title}, resolved_year = ${result.year}, year_mismatch = ${result.yearMismatch}
      where id = ${args.entryId} and session_id = ${args.sessionId} and resolution = 'pending'`;
  } else if (result.status === "not_found") {
    await sql`
      update reference_entries set resolution = 'not_found'
      where id = ${args.entryId} and session_id = ${args.sessionId} and resolution = 'pending'`;
  }
  return result;
}
