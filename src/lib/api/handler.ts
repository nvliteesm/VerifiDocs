// The wrapper every API route goes through.
//   1. refuse a cross-site write, 2. resolve the session (starting one, with its cookie, if needed),
//   3. run the handler, 4. attach a new session's Set-Cookie, 5. turn any error into a safe JSON response.
// Handlers take their dependencies as arguments, so the whole API is tested against the real dev database with
// a fake model client, without a running server.
import { getSql } from "../db";
import { getLlm, type Llm } from "../llm/adapter";
import { discoverSources, type DiscoverResult } from "../pipeline/discover-sources";
import type { ReferenceResolution } from "../pipeline/resolve-reference";
import { limitImports, limitModelUse, type Limits } from "../rate-limit";
import type { SqlLike } from "../rag/retrieve";
import { purgeIfDue } from "../retention";
import { resolveSession } from "../session";
import { assertSameOrigin, errorResponse } from "./http";

export interface ApiDeps {
  sql: SqlLike;
  llm: Llm;
  /** Looks one reference up. Defaults to Crossref then OpenAlex. Tests pass a fake. */
  resolve?: (raw: string) => Promise<ReferenceResolution>;
  now?: () => number;
  /** Rate limits. Defaults to DEFAULT_LIMITS; tests pass small ones. */
  limits?: Limits;
  /** Fetches a Google Doc for an import. Defaults to the global fetch; tests pass a fake, so no test reaches Google. */
  fetch?: typeof fetch;
  /** Find a source for one claim's text. Defaults to OpenAlex with OPENALEX_API_KEY; tests pass a fake. */
  discover?: (claimText: string) => Promise<DiscoverResult>;
  /** Fetches an open-access PDF under the safe-fetch rules. Tests pass a fake, so no test reaches the network. */
  fetchPdf?: (link: string) => Promise<Uint8Array>;
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
    discover: (claimText) => discoverSources(getLlm(), claimText, { apiKey: process.env.OPENALEX_API_KEY || undefined }),
  };
}

function withCookie(response: Response, cookie: string | null): Response {
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}

export interface HandleOptions {
  /** True for routes that call the model (extract, check, ingest): they draw on a per-session and per-address budget. */
  model?: boolean;
  /** True for the import route, which opens a connection to Google: it has its own per-session budget. */
  imports?: boolean;
}

export async function handleWith(
  deps: ApiDeps,
  request: Request,
  fn: (context: ApiContext) => Promise<Response>,
  options: HandleOptions = {},
): Promise<Response> {
  let cookie: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await resolveSession(deps.sql, request, deps.limits);
    cookie = session.setCookie;
    // Hard rule 4: delete expired data. At most once an hour, and never allowed to fail the request.
    if (session.active) await purgeIfDue(deps.sql);
    if (options.model) await limitModelUse(deps.sql, request, session.sessionId, deps.limits);
    if (options.imports) await limitImports(deps.sql, session.sessionId, deps.limits);
    return withCookie(await fn({ deps, sessionId: session.sessionId }), cookie);
  } catch (error) {
    return withCookie(errorResponse(error), cookie);
  }
}

export function handle(
  request: Request,
  fn: (context: ApiContext) => Promise<Response>,
  options: HandleOptions = {},
): Promise<Response> {
  return handleWith(defaultDeps(), request, fn, options);
}
