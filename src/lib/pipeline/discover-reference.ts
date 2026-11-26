// Source discovery for one reference-list entry: is there a work online that this entry points to, and can its PDF be
// had? It builds on the resolver that already runs per reference (`resolveReference`, which answers found or not
// found with a strict judge) and adds what that cannot say:
//
//   matched   the strict judge accepted a work: a high-confidence match, so its PDF may be attached without asking
//   possible  a similar work that the strict judge would not accept: shown to the student to confirm, never attached
//   none      nothing reliable. That says nothing about whether the reference exists: Indonesian theses, proceedings,
//             government reports and standards are often simply not indexed
//   error     a lookup failed; try again later
//
// Laws and standards are not looked up at all (nothing indexes them). Network access is injected, so tests make no calls.
import { z } from "zod";
import { normalizeForMatch } from "./citations";
import { classifyReference, type ReferenceType } from "./reference-type";
import { USER_AGENT, firstYear, titleQueries, type FetchFn, type ReferenceResolution } from "./resolve-reference";

export interface SourceCandidate {
  title: string;
  year: number | null;
  doi: string | null;
  venue: string | null;
  /** An open-access PDF link OpenAlex lists. Not checked here: it is fetched under the safe-fetch rules. */
  pdfUrl: string | null;
}

export type Discovery =
  | { state: "matched" | "possible"; type: ReferenceType; candidate: SourceCandidate }
  | { state: "none"; type: ReferenceType }
  | { state: "error"; type: ReferenceType; reason: string };

export interface DiscoverReferenceDeps {
  /** The cached resolver: found, not found, or a failed lookup. */
  resolve: (raw: string) => Promise<ReferenceResolution>;
  fetch: FetchFn;
  openAlexApiKey?: string | undefined;
}

const SELECT = "doi,title,publication_year,authorships,best_oa_location,primary_location";

const work = z.object({
  doi: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  publication_year: z.number().nullable().optional(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string().nullable().optional() }).nullable().optional() })).optional(),
  best_oa_location: z.object({ pdf_url: z.string().nullable().optional() }).nullable().optional(),
  primary_location: z.object({ source: z.object({ display_name: z.string().nullable().optional() }).nullable().optional() }).nullable().optional(),
});
const workList = z.object({ results: z.array(work) });
type Work = z.infer<typeof work>;

const POSSIBLE_TITLE_SHARE = 0.5;
const SURE_TITLE_SHARE = 0.75;
const MIN_TITLE_TOKENS = 3;
/** How much of the entry's own title the candidate must cover, so a short generic title cannot match a long specific one. */
const ENTRY_SHARE_SURE = 0.5;
const ENTRY_SHARE_MIN = 0.4;

function tokens(text: string): string[] {
  return normalizeForMatch(text).split(" ").filter((token) => token.length >= 2);
}

function toCandidate(item: Work, fallbackTitle: string): SourceCandidate {
  return {
    title: item.title ?? fallbackTitle,
    year: item.publication_year ?? null,
    doi: item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//i, "") : null,
    venue: item.primary_location?.source?.display_name ?? null,
    pdfUrl: item.best_oa_location?.pdf_url ?? null,
  };
}

async function openAlex(fetchFn: FetchFn, params: Record<string, string>, key: string | undefined): Promise<Work[]> {
  const query = new URLSearchParams({ ...params, "per-page": "5", select: SELECT });
  if (key) query.set("api_key", key);
  try {
    const response = await fetchFn(`https://api.openalex.org/works?${query}`, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) return [];
    const parsed = workList.safeParse(await response.json());
    return parsed.success ? parsed.data.results : [];
  } catch {
    return [];
  }
}

/** The PDF link and venue for a work the strict judge already accepted. A failed lookup only means "no link". */
async function openAccessFor(resolved: { doi: string | null; title: string }, deps: DiscoverReferenceDeps): Promise<Pick<SourceCandidate, "pdfUrl" | "venue">> {
  const wanted = tokens(resolved.title);
  const results = resolved.doi
    ? await openAlex(deps.fetch, { filter: `doi:${resolved.doi}` }, deps.openAlexApiKey)
    : await openAlex(deps.fetch, { search: resolved.title }, deps.openAlexApiKey);
  const hit = results.find((item) => {
    if (resolved.doi) return true;
    const found = new Set(tokens(item.title ?? ""));
    return wanted.length > 0 && wanted.filter((token) => found.has(token)).length / wanted.length >= 0.9;
  });
  return { pdfUrl: hit?.best_oa_location?.pdf_url ?? null, venue: hit?.primary_location?.source?.display_name ?? null };
}

/** The best look-alike for an entry the strict judge turned down, when it is close enough to be worth asking about. */
async function possibleMatch(raw: string, deps: DiscoverReferenceDeps): Promise<SourceCandidate | null> {
  const rawTokens = new Set(tokens(raw));
  // Titles are compared with the entry's TITLE, not the whole entry: a publisher line ("Medan: Universitas Islam Negeri
  // Sumatera Utara") shares words with any work from that university and made a paper about its public relations look
  // like a match for a thesis on paper-waste bricks.
  const entryTitle = new Set(tokens(referenceTitle(raw)));
  const rawYear = firstYear(raw);
  let best: { score: number; item: Work } | null = null;
  for (const query of titleQueries(raw).slice(0, 2)) {
    for (const item of await openAlex(deps.fetch, { search: query }, deps.openAlexApiKey)) {
      const titleTokens = tokens(item.title ?? "");
      if (titleTokens.length < MIN_TITLE_TOKENS) continue;
      const overlap = titleTokens.filter((token) => entryTitle.has(token)).length;
      const share = overlap / titleTokens.length;
      const entryShare = entryTitle.size > 0 ? overlap / entryTitle.size : 0;
      const name = item.authorships?.[0]?.author?.display_name;
      const family = name ? tokens(name).at(-1) : undefined;
      const authorMatch = family !== undefined && rawTokens.has(family);
      const yearClose = rawYear !== null && item.publication_year != null && Math.abs(rawYear - item.publication_year) <= 1;
      const worthAsking = (share >= SURE_TITLE_SHARE && entryShare >= ENTRY_SHARE_SURE) || (share >= POSSIBLE_TITLE_SHARE && entryShare >= ENTRY_SHARE_MIN && (authorMatch || yearClose));
      if (!worthAsking) continue;
      const score = share + (authorMatch ? 0.2 : 0) + (yearClose ? 0.1 : 0);
      if (!best || score > best.score) best = { score, item };
    }
  }
  return best ? toCandidate(best.item, raw) : null;
}

export async function discoverReference(raw: string, deps: DiscoverReferenceDeps): Promise<Discovery> {
  const type = classifyReference(raw);
  if (type === "regulation" || type === "standard") return { state: "none", type };

  const resolved = await deps.resolve(raw);
  if (resolved.status === "error") return { state: "error", type, reason: resolved.reason };
  if (resolved.status === "found") {
    const access = await openAccessFor(resolved, deps);
    return { state: "matched", type, candidate: { title: resolved.title, year: resolved.year, doi: resolved.doi, ...access } };
  }
  const possible = await possibleMatch(raw, deps);
  return possible ? { state: "possible", type, candidate: possible } : { state: "none", type };
}

/**
 * The title of a reference-list entry, for showing a missing source by its real name. Tries a quoted title, then the
 * text after the year ("Smith, J. (2020). Title. Journal" or "Nama. 2019. Judul. Jurnal"), then the start of the entry.
 */
export function referenceTitle(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const quoted = /[“"«]([^”"»]{8,220})[”"»]/.exec(text);
  if (quoted) return quoted[1]!.trim().replace(/[.,]$/, "");
  const afterYear = /(?:\((?:1[5-9]|20)\d\d[a-z]?\)\.?|\b(?:1[5-9]|20)\d\d[a-z]?\.)\s*([^.]{8,200})\./.exec(text);
  if (afterYear) return afterYear[1]!.trim();
  return text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text;
}

/** "Hermanto, Dony, dkk. 2014": who and when, for the line under a title. */
export function referenceByline(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const match = /^(.{2,70}?)[\s,.(]*\(?((?:1[5-9]|20)\d\d)[a-z]?\)?/.exec(text);
  if (!match) return "";
  return `${match[1]!.replace(/[\s,.(]+$/, "")} ${match[2]}`;
}
