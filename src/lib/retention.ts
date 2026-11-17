// Retention (hard rule 4): drafts, page text and chunks are deleted 30 days after upload.
//
// The database function purge_expired() does the deleting. Nothing scheduled calls it yet (no host is chosen, and a
// cron may need a card), so it is run from the API itself, when a student starts or returns to a session. A
// counter in the rate_limits table lets only one request per window actually run it, across every server instance.
// This means expired data is removed shortly after the next visit, not at the exact minute it expires.
import type postgres from "postgres";
import { RateLimitError, consume } from "./rate-limit";
import type { SqlLike } from "./rag/retrieve";

/** How often the purge may run. An hour is often enough for a 30-day promise and cheap for the database. */
export const PURGE_EVERY_SECONDS = 60 * 60;

export interface PurgeResult {
  runsDeleted: number;
  documentsDeleted: number;
  sessionsDeleted: number;
}

/**
 * Runs purge_expired() unless it already ran in the last `windowSeconds`. Returns what it deleted, or null when it
 * did not run. It never throws: a failed purge must not stop a student from using the product, and it is tried
 * again in the next window.
 */
export async function purgeIfDue(db: SqlLike, windowSeconds: number = PURGE_EVERY_SECONDS): Promise<PurgeResult | null> {
  const sql = db as postgres.Sql;
  try {
    // The first hit in a window passes. Every later hit is over the limit of 1 and is refused until the window ends.
    await consume(sql, "purge:expired", 1, windowSeconds);
  } catch (error) {
    if (error instanceof RateLimitError) return null;
    console.error(`Purge check failed: ${error instanceof Error ? error.name : typeof error}`);
    return null;
  }
  try {
    const [row] = await sql<{ runs_deleted: number; documents_deleted: number; sessions_deleted: number }[]>`
      select * from purge_expired()`;
    return {
      runsDeleted: row?.runs_deleted ?? 0,
      documentsDeleted: row?.documents_deleted ?? 0,
      sessionsDeleted: row?.sessions_deleted ?? 0,
    };
  } catch (error) {
    console.error(`Purge failed: ${error instanceof Error ? error.name : typeof error}`);
    return null;
  }
}
