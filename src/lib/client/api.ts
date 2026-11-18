// The browser's API client.
//
// - Retries what is worth retrying: a network failure, and a 503 that the server marked `retry` (the model is
//   busy, or Neon's free compute is waking up after being idle). It honours Retry-After, backs off, and gives up
//   after a few attempts with a plain error.
// - Reports "the database is waking up" through `onWaking`, so the page can say so instead of showing an error.
// - Never puts draft text in an error message or a log line.
import type {
  CheckResponse,
  ClientEventName,
  CreateRunResponse,
  ExtractResponse,
  ImportResponse,
  IngestResponse,
  RunResponse,
  SourceView,
  UploadResponse,
  VerifyInput, FindSourcesResponse } from "./types";

export class ApiClientError extends Error {
  override name = "ApiClientError";
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ApiOptions {
  /** Called with true when the database is waking up, and false once a request succeeds. */
  onWaking?: (waking: boolean) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const DEFAULT_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 8_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

interface ErrorBody {
  error?: { code?: string; message?: string; retry?: boolean };
}

export function createApi(options: ApiOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;

  async function rawSend<T>(method: string, path: string, body?: { json?: unknown; form?: FormData }): Promise<T> {
    const init: RequestInit = { method, credentials: "same-origin" };
    if (body?.json !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body.json);
    } else if (body?.form) {
      init.body = body.form;
    }

    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(path, init);
      } catch {
        if (attempt >= maxAttempts) throw new ApiClientError(0, "network", "Could not reach the server. Check your connection and try again.");
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) {
        options.onWaking?.(false);
        const text = await response.text();
        return (text ? JSON.parse(text) : null) as T;
      }

      let parsed: ErrorBody = {};
      try {
        parsed = (await response.json()) as ErrorBody;
      } catch {
        /* a non-JSON error body: fall through with a generic message */
      }
      const code = parsed.error?.code ?? "error";
      const message = parsed.error?.message ?? "Something went wrong.";

      if (code === "database_waking") options.onWaking?.(true);
      const retryable = response.status === 503 && parsed.error?.retry === true;
      if (retryable && attempt < maxAttempts) {
        const hinted = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted * 1_000, MAX_BACKOFF_MS) : backoffMs(attempt));
        continue;
      }
      throw new ApiClientError(response.status, code, message);
    }
  }

  // The first request goes alone. A request with no session cookie starts a session and sets the cookie; two such
  // requests at once start two sessions, and whichever cookie arrives last wins. A check created in the first
  // session then "does not exist" for the second (every request after it says Not found). Seen on a real run, when
  // a draft was submitted while the page's second opening request was still on its way. So every other request waits
  // until the first has finished, after which there is one cookie and nothing left to race.
  let opening: Promise<unknown> | null = null;
  let opened = false;
  async function send<T>(method: string, path: string, body?: { json?: unknown; form?: FormData }): Promise<T> {
    if (opening && !opened) await opening;
    const result = rawSend<T>(method, path, body);
    if (!opening) {
      opening = result.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        opened = true;
      });
    }
    return result;
  }

  return {
    createRun(input: VerifyInput): Promise<CreateRunResponse> {
      if (input.draft.kind === "docx") {
        const form = new FormData();
        form.set("file", input.draft.file);
        if (input.references.trim()) form.set("references", input.references);
        return send("POST", "/api/runs", { form });
      }
      return send("POST", "/api/runs", {
        json: { draft: input.draft.text, ...(input.references.trim() ? { references: input.references } : {}) },
      });
    },
    /** Reads one part of the draft. "skip" records it as not read; "retry" reads a part that was not read again. */
    extract: (runId: string, unit: number, mode: "read" | "skip" | "retry" = "read") =>
      send<ExtractResponse>("POST", `/api/runs/${runId}/extract`, { json: mode === "read" ? { unit } : { unit, mode } }),
    getRun: (runId: string) => send<RunResponse>("GET", `/api/runs/${runId}`),
    /** Find a source for one uncited claim. A repeat returns the saved result; a busy search is retried. */
    findSources: (claimId: string) => send<FindSourcesResponse>("POST", `/api/claims/${claimId}/sources`),
    /** Deletes a check now (its draft text, claims and verdicts). */
    deleteRun: async (runId: string): Promise<void> => {
      await send<null>("DELETE", `/api/runs/${runId}`);
    },
    check: (claimId: string) => send<CheckResponse>("POST", `/api/claims/${claimId}/check`),
    listSources: async () => (await send<{ sources: SourceView[] }>("GET", "/api/sources")).sources,
    upload(file: File): Promise<UploadResponse> {
      const form = new FormData();
      form.set("file", file);
      return send("POST", "/api/sources", { form });
    },
    ingest: (documentId: string) => send<IngestResponse>("POST", `/api/sources/${documentId}/ingest`),
    deleteSource: async (documentId: string): Promise<void> => {
      await send<null>("DELETE", `/api/sources/${documentId}`);
    },
    /** Reads a Google Doc shared as "Anyone with the link". The server fetches it; the text is not saved. */
    importLink: (url: string) => send<ImportResponse>("POST", "/api/import", { json: { url } }),
    /** Reads the text of a PDF draft. Nothing is saved. */
    importPdf(file: File): Promise<ImportResponse> {
      const form = new FormData();
      form.set("file", file);
      return send<ImportResponse>("POST", "/api/import", { form });
    },
    /** Fire and forget. A lost analytics event must never get in the student's way. */
    async event(name: ClientEventName, props: Record<string, unknown> = {}): Promise<void> {
      try {
        if (opening && !opened) await opening; // an event with no session cookie would start a second session too
        await fetchImpl("/api/events", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, props }),
        });
      } catch {
        /* ignored on purpose */
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
