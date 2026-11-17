// Rate limits, kept in Postgres so they work on serverless hosting (an in-memory counter would reset per instance).
//
// A fixed window per key: the first hit opens a window, each later hit adds one, and once the window has passed
// the next hit starts a new one. Two kinds of limit protect the free-tier model quota and the database:
//   - new sessions per caller address (a script that drops its cookie gets a fresh session every time)
//   - model-backed requests per session, and per caller address (extract, check, ingest each call the model)
// Keys hold a hash of the address or a session id, never text. Limits are placeholders to tune from real use.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { SqlLike } from "./rag/retrieve";

export interface Limits {
  /** New sessions one address may start per window. Generous, because a campus network shares one address. */
  newSessionsPerAddress: number;
  /** Model-backed requests one session may make per window. A 60,000-character draft alone takes about 11 extracts. */
  modelPerSession: number;
  /** Model-backed requests one address may make per window, across sessions. */
  modelPerAddress: number;
  windowSeconds: number;
}

export const DEFAULT_LIMITS: Limits = {
  newSessionsPerAddress: 60,
  modelPerSession: 600,
  modelPerAddress: 3000,
  windowSeconds: 3600,
};

export class RateLimitError extends Error {
  override name = "RateLimitError";
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(`Too many requests. Please try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * True only where the forwarded-address headers can be believed: on Vercel (which sets VERCEL=1 and overwrites
 * x-forwarded-for with the real client), or when the operator sets TRUST_PROXY_HEADERS=1 for a proxy they control.
 * Anywhere else a caller can send any address it likes, so the headers are ignored.
 */
export function trustsProxyHeaders(): boolean {
  return process.env.VERCEL === "1" || process.env.TRUST_PROXY_HEADERS === "1";
}

/**
 * The caller's address. Without a trusted proxy every caller shares the one address "unknown", so the per-address
 * limits act as a limit for the whole site instead of being dodged by a forged header.
 */
export function callerAddress(request: Request): string {
  if (!trustsProxyHeaders()) return "unknown";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Counts one hit against `key`. Throws RateLimitError when this hit is over `limit` inside the current window.
 * Hits over the limit are still counted, so a caller that keeps hammering stays blocked until the window ends.
 */
export async function consume(db: SqlLike, key: string, limit: number, windowSeconds: number): Promise<void> {
  const sql = db as postgres.Sql;
  const [row] = await sql<{ count: number; remaining: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count,
      greatest(1, ceil(extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now()))))::int as remaining`;
  if (row && row.count > limit) throw new RateLimitError(row.remaining);
}

/** Removes counters whose window ended long ago. Cheap, and run occasionally from a new-session request. */
export async function sweepExpired(db: SqlLike, windowSeconds: number): Promise<void> {
  const sql = db as postgres.Sql;
  await sql`delete from rate_limits where window_start < now() - make_interval(secs => ${windowSeconds * 2})`;
}

/** Called before a new session is created. */
export async function limitNewSession(db: SqlLike, request: Request, limits: Limits = DEFAULT_LIMITS): Promise<void> {
  await consume(db, `new:${hashKey(callerAddress(request))}`, limits.newSessionsPerAddress, limits.windowSeconds);
  if (Math.random() < 0.02) await sweepExpired(db, limits.windowSeconds); // about one request in fifty
}

/** Called before a request that makes model calls (extract, check, ingest). */
export async function limitModelUse(
  db: SqlLike,
  request: Request,
  sessionId: string,
  limits: Limits = DEFAULT_LIMITS,
): Promise<void> {
  await consume(db, `model:s:${sessionId}`, limits.modelPerSession, limits.windowSeconds);
  await consume(db, `model:a:${hashKey(callerAddress(request))}`, limits.modelPerAddress, limits.windowSeconds);
}
