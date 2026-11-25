// The one path to the web search service (Tavily), as llm/adapter.ts is the one path to Gemini. Open-web search is
// decided in docs/decisions.md (25 Nov 2026) and planned in docs/web-sources.md.
//
// The service is called from the server only. The key goes in the Authorization header, never in a URL, a body, a log
// line or an error message (hard rule 7: no key in the browser). A missing key means the feature is off, not an error:
// the product works as before and the button is not offered.
//
// Nothing here trusts the service's answer more than it must: a result is kept only with an http(s) address, a title
// and some text, and every text is capped. Whether a copied sentence is really on a page is checked by the caller with
// the shared quote check, as it is for OpenAlex abstracts. The model never writes a URL.
import { z } from "zod";

export const WEB_SEARCH_URL = "https://api.tavily.com/search";
export const WEB_EXTRACT_URL = "https://api.tavily.com/extract";

/** One request. The caller's own overall deadline is the real limit (hard rule 6). */
export const DEFAULT_TIMEOUT_MS = 4_500;
const DEFAULT_MAX_RESULTS = 6;
const MIN_SNIPPET_CHARS = 40;
const MAX_SNIPPET_CHARS = 3_000;
const MAX_PAGE_CHARS = 60_000;

export interface WebSearchConfig {
  apiKey: string;
}

/** The key is optional: without TAVILY_API_KEY the feature is off and this returns null. */
export function loadWebSearchConfig(env: Record<string, string | undefined> = process.env): WebSearchConfig | null {
  const apiKey = env.TAVILY_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

/**
 * Why the service could not answer. "quota": the plan's credits are used up (HTTP 432 or 433), so trying again cannot
 * help until the month turns. "auth": the key is missing or wrong (401), a setup problem. "busy": too many requests
 * or too slow (429, 434, a timeout), worth another try. "failed": anything else.
 */
export type WebFailure = "quota" | "auth" | "busy" | "failed";

export class WebSearchUnavailableError extends Error {
  override name = "WebSearchUnavailableError";
  readonly reason: WebFailure;
  readonly status: number | undefined;
  constructor(message: string, reason: WebFailure, status?: number) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

export interface WebResult {
  url: string;
  title: string;
  /** The service's snippet of the page: a few passages joined together. The sentence shown to the student comes from it. */
  content: string;
  score: number;
}

export interface WebPage {
  url: string;
  /** The page as plain text, for checking a claim against it. */
  text: string;
}

export interface WebSearch {
  /** Searches the web. Never throws for an empty answer; throws WebSearchUnavailableError when the service fails. */
  search(query: string, options?: { maxResults?: number; timeoutMs?: number; excludeDomains?: string[] }): Promise<WebResult[]>;
  /** The text of one page, or null when the service could not read it. Throws WebSearchUnavailableError on a service failure. */
  extract(url: string, options?: { timeoutMs?: number }): Promise<WebPage | null>;
}

export type PostFn = (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<Response>;

const defaultPost: PostFn = (url, init) =>
  fetch(url, { method: "POST", headers: init.headers, body: init.body, signal: AbortSignal.timeout(init.timeoutMs) });

const searchSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      score: z.number().nullable().optional(),
    }),
  ),
});

const extractSchema = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string().nullable().optional() })).optional(),
  failed_results: z.array(z.object({ url: z.string() })).optional(),
});

/** An http(s) address without its fragment, or null. Anything else (javascript:, data:, a relative path) is refused. */
export function cleanUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The service returns a snippet as markdown ("### Free", "- item", "**bold**", links, table rows). A student reads the
 * sentence as plain text and the model copies it, so it is turned into plain text here: before the model sees it and
 * before the quote check, so the check compares the very words that are shown. Text with no markup comes back as it was.
 * Line breaks are kept, because the markers that matter sit at the start of a line; callers collapse spacing after.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ")
    .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+•][ \t]+/gm, "")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2");
}

function failureFor(status: number): WebFailure {
  if (status === 401) return "auth";
  if (status === 432 || status === 433) return "quota";
  if (status === 429 || status === 434) return "busy";
  return "failed";
}

function isTimeout(error: unknown): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "TimeoutError" || name === "AbortError";
}

export function createWebSearch(config: WebSearchConfig, post: PostFn = defaultPost): WebSearch {
  async function call(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
      response = await post(url, {
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        timeoutMs,
      });
    } catch (error) {
      // The message never carries the address or the key.
      if (isTimeout(error)) throw new WebSearchUnavailableError("The web search service timed out.", "busy");
      throw new WebSearchUnavailableError("The web search service could not be reached.", "busy");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebSearchUnavailableError(`The web search service answered HTTP ${response.status}.`, failureFor(response.status), response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new WebSearchUnavailableError("The web search service sent an answer that is not JSON.", "failed", response.status);
    }
  }

  async function search(
    query: string,
    options: { maxResults?: number; timeoutMs?: number; excludeDomains?: string[] } = {},
  ): Promise<WebResult[]> {
    const json = await call(
      WEB_SEARCH_URL,
      {
        query,
        search_depth: "basic",
        topic: "general",
        max_results: options.maxResults ?? DEFAULT_MAX_RESULTS,
        include_answer: false,
        include_raw_content: false,
        safe_search: true,
        // The service allows up to 150; a longer list is cut here so a request is never refused for its size.
        ...(options.excludeDomains?.length ? { exclude_domains: options.excludeDomains.slice(0, 150) } : {}),
      },
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const parsed = searchSchema.safeParse(json);
    if (!parsed.success) throw new WebSearchUnavailableError("The web search service sent an answer in an unexpected shape.", "failed");

    const seen = new Set<string>();
    const results: WebResult[] = [];
    for (const raw of parsed.data.results) {
      const url = cleanUrl(raw.url);
      const title = (raw.title ?? "").replace(/\s+/g, " ").trim();
      const content = plainText(raw.content ?? "").replace(/\s+/g, " ").trim();
      if (!url || seen.has(url) || title === "" || content.length < MIN_SNIPPET_CHARS) continue;
      seen.add(url);
      results.push({ url, title, content: content.slice(0, MAX_SNIPPET_CHARS), score: raw.score ?? 0 });
    }
    return results;
  }

  async function extract(rawUrl: string, options: { timeoutMs?: number } = {}): Promise<WebPage | null> {
    const url = cleanUrl(rawUrl);
    if (!url) return null;
    const json = await call(WEB_EXTRACT_URL, { urls: [url], extract_depth: "basic", format: "text" }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const parsed = extractSchema.safeParse(json);
    if (!parsed.success) throw new WebSearchUnavailableError("The web search service sent an answer in an unexpected shape.", "failed");
    // A 200 can carry an empty list or a failed entry: both mean no text.
    const page = parsed.data.results?.find((r) => (r.raw_content ?? "").trim().length > 0);
    if (!page) return null;
    return { url, text: page.raw_content!.trim().slice(0, MAX_PAGE_CHARS) };
  }

  return { search, extract };
}
