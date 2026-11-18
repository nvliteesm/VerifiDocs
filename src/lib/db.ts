// The one place the app opens a connection to Neon.
//
// - Uses the pooled URL (DATABASE_URL). That goes through PgBouncer in transaction mode, which cannot keep
//   prepared statements, so `prepare` is off.
// - Neon's free compute sleeps after 5 idle minutes, so the first request can find the database waking up.
//   `isWakingError` recognises that case so the API can answer 503 "retry" and the UI can show "waking up"
//   instead of an error.
import postgres from "postgres";

const globalForSql = globalThis as unknown as { __verifidocsSql?: postgres.Sql };

export function getSql(): postgres.Sql {
  if (!globalForSql.__verifidocsSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    globalForSql.__verifidocsSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForSql.__verifidocsSql;
}

const WAKING_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  // A DNS lookup that failed for a moment (seen on a long scan: a run of requests answered 500 for the same blip).
  // Nothing is wrong with the query, so the browser should try again, not show an error.
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin shutdown
  "57P03", // cannot connect now
  "08000",
  "08001",
  "08003",
  "08006",
]);

/** True for errors that mean "the database is not reachable right now", not "the query is wrong". */
export function isWakingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && WAKING_CODES.has(code)) return true;
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) && errors.length > 0 && errors.every(isWakingError);
}
