// HTTP helpers for the API: JSON responses, safe error mapping, an origin check, and bounded body reading.
//
// Errors are mapped to short fixed messages. An unexpected error is logged by name and code only and is never
// echoed to the client, because an error message can carry user text.
import { ZodError } from "zod";
import { isWakingError } from "../db";
import { LlmOutputError, LlmUnavailableError } from "../llm/adapter";
import { DraftError } from "../pipeline/parse-draft";
import { IngestError, type IngestErrorCode } from "../pipeline/ingest";
import { RateLimitError } from "../rate-limit";

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const INGEST_STATUS: Record<IngestErrorCode, number> = {
  too_large: 413,
  not_a_pdf: 415,
  unreadable: 422,
  too_many_pages: 413,
  too_many_documents: 409,
  not_found: 404,
};

function failure(status: number, code: string, message: string, retry = false, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message, ...(retry ? { retry: true } : {}) } }, status, headers);
}

/** Turns any thrown value into a safe JSON error response. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return failure(error.status, error.code, error.message);
  if (error instanceof DraftError) return failure(400, error.code, error.message);
  if (error instanceof IngestError) return failure(INGEST_STATUS[error.code], error.code, error.message);
  if (error instanceof ZodError) return failure(400, "invalid_request", "The request is not in the expected shape.");
  if (error instanceof RateLimitError) {
    return failure(429, "rate_limited", error.message, false, { "retry-after": String(error.retryAfterSeconds) });
  }
  if (error instanceof LlmUnavailableError || error instanceof LlmOutputError) {
    return failure(503, "model_unavailable", "The AI service is busy. Try again in a moment.", true, { "retry-after": "2" });
  }
  if (isWakingError(error)) {
    return failure(503, "database_waking", "The database is waking up. Try again in a few seconds.", true, { "retry-after": "3" });
  }
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`Unexpected API error: ${name}${typeof code === "string" ? ` (${code})` : ""}`);
  return failure(500, "internal", "Something went wrong on our side.");
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuses a write whose Origin header names a different site. With SameSite=Lax cookies this is a second
 * line of defence. A request with no Origin header (curl, scripts) is allowed: it has no ambient cookies.
 */
export function assertSameOrigin(request: Request): void {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "bad_origin", "Cross-site requests are not allowed.");
  }
  if (originHost !== host) throw new ApiError(403, "bad_origin", "Cross-site requests are not allowed.");
}

export const MAX_JSON_BYTES = 200_000;

/** Reads a JSON body, refusing anything over `maxBytes` before and after reading. */
export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError(415, "unsupported_type", "Send the request as JSON.");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ApiError(413, "too_large", "The request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, "too_large", "The request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export interface Upload {
  bytes: Uint8Array;
  filename: string;
  form: FormData;
}

/** Reads a multipart upload with one file field, refusing it if it is over `maxBytes`. */
export async function readUpload(request: Request, field: string, maxBytes: number): Promise<Upload> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    throw new ApiError(415, "unsupported_type", "Send the file as multipart form data.");
  }
  // Allow some room for the form's own framing before the file size is checked precisely.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes + 200_000) throw new ApiError(413, "too_large", "The file is too large.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "invalid_form", "The upload could not be read.");
  }
  const file = form.get(field);
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", `A "${field}" file is required.`);
  if (file.size > maxBytes) throw new ApiError(413, "too_large", "The file is too large.");
  return { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, form };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that is not a UUID cannot exist, so it is a plain 404 and never reaches a query. */
export function assertId(value: string): string {
  if (!UUID.test(value)) throw new ApiError(404, "not_found", "Not found.");
  return value;
}
