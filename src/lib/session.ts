// Sessions: no accounts (hard rule 7). A random token in an httpOnly cookie identifies the user, and every
// read, write and delete is scoped to the session it resolves to. There is no shared API key in the browser.
//
// - The token is 256 random bits. Only its SHA-256 hash is stored, so a database leak does not leak sessions.
// - The cookie is HttpOnly (page scripts cannot read it) and SameSite=Lax (not sent on cross-site POSTs).
// - A missing, malformed or unknown cookie starts a fresh, empty session. It never reveals another one.
import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { logEvent } from "./events";
import { limitNewSession, type Limits } from "./rate-limit";
import type { SqlLike } from "./rag/retrieve";

export const SESSION_COOKIE = "vd_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Reads one cookie from a Cookie header. Returns null if absent. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]!.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function buildSessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export interface SessionContext {
  sessionId: string;
  /** A Set-Cookie header value when a new session was started, otherwise null. */
  setCookie: string | null;
}

export async function resolveSession(db: SqlLike, request: Request, limits?: Limits): Promise<SessionContext> {
  const sql = db as postgres.Sql;
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);

  if (token && TOKEN_PATTERN.test(token)) {
    const [existing] = await sql<{ id: string }[]>`
      select id from sessions where token_hash = ${hashToken(token)}`;
    if (existing) {
      // Touch it at most every five minutes, so a busy page does not write on every request.
      await sql`
        update sessions set last_seen_at = now()
        where id = ${existing.id} and last_seen_at < now() - interval '5 minutes'`;
      return { sessionId: existing.id, setCookie: null };
    }
  }

  // A new session is the cheap way to dodge every per-session limit, so starting one is itself limited.
  await limitNewSession(sql, request, limits);
  const fresh = newToken();
  const [created] = await sql<{ id: string }[]>`
    insert into sessions (token_hash) values (${hashToken(fresh)}) returning id`;
  await logEvent(sql, created!.id, "session_started", { source: "direct" });
  return { sessionId: created!.id, setCookie: buildSessionCookie(fresh, isSecureRequest(request)) };
}
