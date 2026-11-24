// Stage 3, second half: resolve one reference-list entry against Crossref, then OpenAlex.
//
// - Only the reference entry's own text is sent to these public APIs, never claim or draft text.
// - Requests carry a generic User-Agent and no personal contact details.
// - A candidate counts as a match only if its TITLE matches the entry and its FIRST AUTHOR's surname
//   appears in the entry. A year difference alone does not reject it (preprints and mirrors carry other
//   years); it sets `yearMismatch` instead. Real-sounding titles with a different author are rejected.
// - "not_found" is returned only when every lookup that ran completed and nothing matched. If a lookup
//   failed (timeout, 429, 5xx) the result is "error", so the stage retries instead of wrongly
//   saying the reference does not exist.
import { z } from "zod";
import { normalizeForMatch } from "./citations";

/** Per request, and the cap on one whole reference lookup. A claim check has about 10 seconds in total. */
export const REQUEST_TIMEOUT_MS = 5_000;
export const RESOLVE_DEADLINE_MS = 7_000;
/** Not worth starting a request with less time than this left. */
const MIN_REQUEST_MS = 300;
/** Generic, with no contact details (docs/decisions.md, 17 Nov). Also used by discover-sources.ts. */
export const USER_AGENT = "VerifiDocs-portfolio/0.1";
const TITLE_CONTAINMENT_MIN = 0.8;
const DOI_TITLE_CONTAINMENT_MIN = 0.6;
/**
 * A record whose title is only close to the entry's ("Generative Adversarial Networks" for the NeurIPS title
 * "Generative adversarial nets") still counts when its first author is the entry's FIRST author and the year is
 * within one. The first author, not any author: Mirza's "Conditional GAN" (2014) shares most words and lists
 * Mirza first, and Mirza is a co-author in the GAN entry.
 */
const CLOSE_TITLE_CONTAINMENT_MIN = 0.6;
const CLOSE_TITLE_MIN_TOKENS = 3;
const MAX_TITLE_QUERIES = 3;
const MAX_QUERY_CHARS = 200;

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; timeoutMs?: number },
) => Promise<Response>;

export type ReferenceResolution =
  | {
      status: "found";
      resolver: "crossref" | "openalex";
      doi: string | null;
      title: string;
      year: number | null;
      /** The entry names a year more than one away from the match. The reference exists; the year may be mistyped. */
      yearMismatch: boolean;
    }
  | { status: "not_found" }
  | { status: "error"; reason: string };

interface Candidate {
  resolver: "crossref" | "openalex";
  title: string;
  year: number | null;
  firstAuthorFamily: string | null;
  doi: string | null;
}

const crossrefItem = z.object({
  DOI: z.string().optional(),
  title: z.array(z.string()).optional(),
  issued: z.object({ "date-parts": z.array(z.array(z.number().nullable())).optional() }).optional(),
  author: z.array(z.object({ family: z.string().optional() })).optional(),
});
const crossrefList = z.object({ message: z.object({ items: z.array(crossrefItem) }) });
const crossrefSingle = z.object({ message: crossrefItem });

const openAlexWork = z.object({
  doi: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  publication_year: z.number().nullable().optional(),
  authorships: z
    .array(z.object({ author: z.object({ display_name: z.string().nullable().optional() }).nullable().optional() }))
    .optional(),
});
const openAlexList = z.object({ results: z.array(openAlexWork) });

function fromCrossref(item: z.infer<typeof crossrefItem>): Candidate | null {
  const title = item.title?.[0];
  if (!title) return null;
  return {
    resolver: "crossref",
    title,
    year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
    firstAuthorFamily: item.author?.[0]?.family ? normalizeForMatch(item.author[0].family) : null,
    doi: item.DOI ?? null,
  };
}

function fromOpenAlex(work: z.infer<typeof openAlexWork>): Candidate | null {
  if (!work.title) return null;
  const name = work.authorships?.[0]?.author?.display_name;
  const family = name ? normalizeForMatch(name).split(" ").at(-1) : undefined;
  return {
    resolver: "openalex",
    title: work.title,
    year: work.publication_year ?? null,
    firstAuthorFamily: family ?? null,
    doi: work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, "") : null,
  };
}

function tokensOf(text: string): string[] {
  return normalizeForMatch(text).split(" ").filter((token) => token.length >= 2);
}

function containment(titleTokens: string[], rawTokens: Set<string>): number {
  if (titleTokens.length === 0) return 0;
  return titleTokens.filter((token) => rawTokens.has(token)).length / titleTokens.length;
}

/** The first year written in a reference entry, as the student wrote it. */
export function firstYear(raw: string): number | null {
  const match = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * The entry's first author's surname, when the entry starts the APA way: "Goodfellow, I., ..." or
 * "Warde-Farley, D. ...". `text` is as written (for a search filter); `family` is its last word, normalized.
 * Null for any other shape ("Bank Indonesia. (2024)", "A. Vaswani et al."), so nothing is guessed.
 */
function leadAuthor(raw: string): { text: string; family: string } | null {
  const match = /^\s*([\p{L}'’-]+(?:\s[\p{L}'’-]+)?),\s*\p{Lu}\./u.exec(raw);
  if (!match) return null;
  const family = normalizeForMatch(match[1]!).split(" ").at(-1);
  return family && family.length >= 2 ? { text: match[1]!, family } : null;
}

/** The title of an APA entry: the text after "(2017)." up to the next sentence end. Null for other shapes. */
function apaTitle(raw: string): string | null {
  const afterYear = /\(\s*(?:1[5-9]\d{2}|20\d{2})[a-z]?\s*\)\.?\s*(.+)/s.exec(raw)?.[1];
  const title = afterYear?.split(/(?<=[.?!])\s+/)[0]?.replace(/[.\s]+$/, "").trim();
  return title && title.length >= 12 ? title.slice(0, MAX_QUERY_CHARS) : null;
}

/** Decides whether a candidate is the entry's reference. Exported for tests. */
export function judgeCandidate(
  raw: string,
  candidate: Pick<Candidate, "title" | "year" | "firstAuthorFamily">,
): { match: boolean; yearMismatch: boolean } {
  const rawTokens = new Set(tokensOf(raw));
  const titleTokens = tokensOf(candidate.title);
  if (titleTokens.length < 2) return { match: false, yearMismatch: false };

  const rawYear = firstYear(raw);
  const yearKnown = rawYear !== null && candidate.year !== null;
  const yearClose = yearKnown && Math.abs(rawYear - candidate.year!) <= 1;

  const share = containment(titleTokens, rawTokens);
  if (share < TITLE_CONTAINMENT_MIN) {
    const lead = leadAuthor(raw);
    const closeTitle =
      share >= CLOSE_TITLE_CONTAINMENT_MIN &&
      titleTokens.length >= CLOSE_TITLE_MIN_TOKENS &&
      yearClose &&
      lead !== null &&
      candidate.firstAuthorFamily !== null &&
      candidate.firstAuthorFamily.split(" ").at(-1) === lead.family;
    return { match: closeTitle, yearMismatch: false };
  }

  if (candidate.firstAuthorFamily) {
    if (!rawTokens.has(candidate.firstAuthorFamily)) return { match: false, yearMismatch: false };
  } else if (!yearClose) {
    // No author on the candidate: only an exact year can back up the title.
    return { match: false, yearMismatch: false };
  }
  return { match: true, yearMismatch: yearKnown && !yearClose };
}

/** Title-like pieces of an entry, used as OpenAlex search queries. Exported for tests. */
export function titleQueries(raw: string): string[] {
  const quoted = [...raw.matchAll(/["“]([^"“”]{12,200})["”]/g)].map((m) => m[1]!.trim());

  const withoutYear = raw.replace(/\(\s*(?:1[5-9]\d{2}|20\d{2})[a-z]?\s*\)/, ". ");
  const segments = withoutYear
    .split(/(?<=[.?!])\s+/)
    .map((segment) => segment.replace(/[.?!,;:\s]+$/, "").trim())
    .filter((segment) => {
      if (segment.length < 12 || segment.split(/\s+/).length < 3) return false;
      const initials = (segment.match(/\b\p{Lu}\./gu) ?? []).length;
      return !(segment.includes("&") || initials >= 2);
    });

  const unique = [...new Set([...quoted, ...segments.sort((a, b) => b.length - a.length)])];
  const queries = unique.slice(0, MAX_TITLE_QUERIES).map((q) => q.slice(0, MAX_QUERY_CHARS));
  return queries.length > 0 ? queries : [raw.trim().slice(0, MAX_QUERY_CHARS)];
}

function extractDoi(raw: string): string | null {
  const match = /\b10\.\d{4,9}\/[^\s"<>]+/.exec(raw);
  return match ? match[0].replace(/[.,;:)\]]+$/, "") : null;
}

type Fetched<T> = { kind: "ok"; data: T } | { kind: "notfound" } | { kind: "error"; reason: string };

async function getJson<T>(fetchFn: FetchFn, url: string, schema: z.ZodType<T>, source: string): Promise<Fetched<T>> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  } catch {
    return { kind: "error", reason: `${source} could not be reached` };
  }
  if (response.status === 404) return { kind: "notfound" };
  if (!response.ok) return { kind: "error", reason: `${source} returned HTTP ${response.status}` };
  try {
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "error", reason: `${source} returned an unexpected response` };
  } catch {
    return { kind: "error", reason: `${source} returned an unreadable response` };
  }
}

function pickBest(raw: string, candidates: (Candidate | null)[]): ReferenceResolution | null {
  let fallback: ReferenceResolution | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const verdict = judgeCandidate(raw, candidate);
    if (!verdict.match) continue;
    const found: ReferenceResolution = {
      status: "found",
      resolver: candidate.resolver,
      doi: candidate.doi,
      title: candidate.title,
      year: candidate.year,
      yearMismatch: verdict.yearMismatch,
    };
    if (!verdict.yearMismatch) return found;
    fallback ??= found;
  }
  return fallback;
}

export const defaultFetch: FetchFn = (url, init) =>
  fetch(url, {
    ...(init?.headers ? { headers: init.headers } : {}),
    signal: AbortSignal.timeout(init?.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });

/**
 * Stops issuing requests once the overall deadline is spent, and caps each request's timeout at the time left.
 * A request that cannot be made counts as a failed lookup, so the result is "error" (retry), never "not_found".
 */
export function withDeadline(fetchFn: FetchFn, deadlineAt: number, now: () => number): FetchFn {
  return async (url, init) => {
    const remaining = deadlineAt - now();
    if (remaining < MIN_REQUEST_MS) throw new Error("The lookup deadline was reached.");
    return fetchFn(url, { ...init, timeoutMs: Math.min(remaining, REQUEST_TIMEOUT_MS) });
  };
}

export type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Statuses worth one more try: the public Crossref pool answers 429 when it is busy. */
const RETRY_STATUSES = new Set([429, 503]);
const DEFAULT_RETRY_WAIT_MS = 1_000;
const MAX_RETRY_WAIT_MS = 3_000;

function retryDelayMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : DEFAULT_RETRY_WAIT_MS;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

/** Retries a request once after the server's Retry-After wait (capped). A thrown error is not retried here. */
function withRetry(fetchFn: FetchFn, sleep: SleepFn): FetchFn {
  return async (url, init) => {
    const first = await fetchFn(url, init);
    if (!RETRY_STATUSES.has(first.status)) return first;
    await sleep(retryDelayMs(first));
    return fetchFn(url, init);
  };
}

export interface ResolveOptions {
  /** Total time one lookup may take, across every request and retry wait. */
  deadlineMs?: number;
  now?: () => number;
  /** The free OpenAlex key (OPENALEX_API_KEY). Without it OpenAlex answers 429 under load (UAT 23 Nov 2026). */
  openAlexApiKey?: string;
}

/** OpenAlex search URL, with the key when there is one. */
function openAlexSearchUrl(params: Record<string, string>, apiKey: string | undefined): string {
  const query = new URLSearchParams({ ...params, "per-page": "5", select: "doi,title,publication_year,authorships" });
  if (apiKey) query.set("api_key", apiKey);
  return `https://api.openalex.org/works?${query}`;
}

export async function resolveReference(
  raw: string,
  baseFetch: FetchFn = defaultFetch,
  sleep: SleepFn = defaultSleep,
  options: ResolveOptions = {},
): Promise<ReferenceResolution> {
  const now = options.now ?? Date.now;
  const deadlineAt = now() + (options.deadlineMs ?? RESOLVE_DEADLINE_MS);
  const fetchFn = withRetry(withDeadline(baseFetch, deadlineAt, now), sleep);
  const entry = raw.trim();
  const errors: string[] = [];
  const note = (result: Fetched<unknown>) => {
    if (result.kind === "error") errors.push(result.reason);
  };

  // 1. A DOI in the entry is the strongest lead. It only counts if the resolved title fits the entry.
  const doi = extractDoi(entry);
  if (doi) {
    const rawTokens = new Set(tokensOf(entry));
    const viaCrossref = await getJson(fetchFn, `https://api.crossref.org/works/${encodeURI(doi)}`, crossrefSingle, "Crossref");
    note(viaCrossref);
    if (viaCrossref.kind === "ok") {
      const candidate = fromCrossref(viaCrossref.data.message);
      if (candidate && containment(tokensOf(candidate.title), rawTokens) >= DOI_TITLE_CONTAINMENT_MIN) {
        const year = firstYear(entry);
        return {
          status: "found", resolver: "crossref", doi: candidate.doi ?? doi, title: candidate.title,
          year: candidate.year, yearMismatch: year !== null && candidate.year !== null && Math.abs(year - candidate.year) > 1,
        };
      }
    } else if (viaCrossref.kind === "notfound") {
      const keyParam = options.openAlexApiKey ? `&api_key=${encodeURIComponent(options.openAlexApiKey)}` : "";
      const viaOpenAlex = await getJson(
        fetchFn, `https://api.openalex.org/works/doi:${encodeURI(doi)}?select=doi,title,publication_year,authorships${keyParam}`,
        openAlexWork, "OpenAlex",
      );
      note(viaOpenAlex);
      if (viaOpenAlex.kind === "ok") {
        const candidate = fromOpenAlex(viaOpenAlex.data);
        if (candidate && containment(tokensOf(candidate.title), rawTokens) >= DOI_TITLE_CONTAINMENT_MIN) {
          const year = firstYear(entry);
          return {
            status: "found", resolver: "openalex", doi: candidate.doi ?? doi, title: candidate.title,
            year: candidate.year, yearMismatch: year !== null && candidate.year !== null && Math.abs(year - candidate.year) > 1,
          };
        }
      }
    }
  }

  // 2. Crossref, searching with the whole entry.
  const crossrefUrl =
    "https://api.crossref.org/works?" +
    new URLSearchParams({ "query.bibliographic": entry.slice(0, 500), rows: "5", select: "DOI,title,issued,author" });
  const crossref = await getJson(fetchFn, crossrefUrl, crossrefList, "Crossref");
  note(crossref);
  // A Crossref match whose year is far off is kept only as a fallback: the original is often in OpenAlex under the
  // right year (UAT 23 Nov 2026: "Attention is all you need", 2017, matched a 2025 Crossref record).
  let crossrefFallback: ReferenceResolution | null = null;
  if (crossref.kind === "ok") {
    const best = pickBest(entry, crossref.data.message.items.map(fromCrossref));
    if (best?.status === "found" && !best.yearMismatch) return best;
    crossrefFallback = best;
  }

  // 3. OpenAlex. First by the entry's first author and nearby years, which finds a famous title that plain searches
  //    bury under look-alikes (GAN); then by title-like pieces of the entry (a whole entry returns noise there).
  const queries = titleQueries(entry);
  const lead = leadAuthor(entry);
  const year = firstYear(entry);
  const title = apaTitle(entry);
  const searches: Record<string, string>[] = [];
  if (lead && year !== null && title) {
    searches.push({
      search: title,
      filter: `raw_author_name.search:${lead.text.replace(/[,|:]/g, " ")},publication_year:${year - 1}-${year + 1}`,
    });
  }
  for (const query of queries) searches.push({ search: query });

  const openAlexCandidates: (Candidate | null)[] = [];
  for (const params of searches) {
    const result = await getJson(fetchFn, openAlexSearchUrl(params, options.openAlexApiKey), openAlexList, "OpenAlex");
    note(result);
    if (result.kind !== "ok") continue;
    openAlexCandidates.push(...result.data.results.map(fromOpenAlex));
    const best = pickBest(entry, openAlexCandidates);
    if (best?.status === "found" && !best.yearMismatch) return best;
  }

  // 4. A far-year match is still a match: the reference exists and the year may be mistyped.
  const best = crossrefFallback ?? pickBest(entry, openAlexCandidates);
  if (best) return best;

  // 5. Nothing matched. Say "not found" only if every lookup that ran actually answered.
  if (errors.length > 0) return { status: "error", reason: [...new Set(errors)].join("; ") };
  return { status: "not_found" };
}
