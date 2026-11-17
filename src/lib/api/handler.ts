// The wrapper every API route goes through.
//   1. refuse a cross-site write, 2. resolve the session (starting one, with its cookie, if needed),
//   3. run the handler, 4. attach a new session's Set-Cookie, 5. turn any error into a safe JSON response.
// Handlers take their dependencies as arguments, so the whole API is tested against the real dev database with
// a fake model client, without a running server.
import { getSql } from "../db";
import { getLlm, type Llm } from "../llm/adapter";
import type { ReferenceResolution } from "../pipeline/resolve-reference";
import type { SqlLike } from "../rag/retrieve";
import { resolveSession } from "../session";
import { assertSameOrigin, errorResponse } from "./http";

export interface ApiDeps {
  sql: SqlLike;
  llm: Llm;
  /** Looks one reference up. Defaults to Crossref then OpenAlex. Tests pass a fake. */
  resolve?: (raw: string) => Promise<ReferenceResolution>;
  now?: () => number;
}

export interface ApiContext {
  deps: ApiDeps;
  sessionId: string;
}

/** The real dependencies. The model client is built only when a handler first uses it. */
export function defaultDeps(): ApiDeps {
  return {
    sql: getSql(),
    get llm(): Llm {
      return getLlm();
    },
  };
}

function withCookie(response: Response, cookie: string | null): Response {
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}

export async function handleWith(
  deps: ApiDeps,
  request: Request,
  fn: (context: ApiContext) => Promise<Response>,
): Promise<Response> {
  let cookie: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await resolveSession(deps.sql, request);
    cookie = session.setCookie;
    return withCookie(await fn({ deps, sessionId: session.sessionId }), cookie);
  } catch (error) {
    return withCookie(errorResponse(error), cookie);
  }
}

export function handle(request: Request, fn: (context: ApiContext) => Promise<Response>): Promise<Response> {
  return handleWith(defaultDeps(), request, fn);
}
