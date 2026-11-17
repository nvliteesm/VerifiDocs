import { describe, expect, it } from "vitest";
import {
  judgeCandidate,
  resolveReference,
  titleQueries,
  type FetchFn,
} from "./resolve-reference";

const VASWANI =
  "Vaswani, A., Shazeer, N., Parmar, N., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.";

const noSleep = async () => {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const crossrefList = (items: unknown[]) => json({ message: { items } });
const openAlexList = (results: unknown[]) => json({ results });
const crossrefWork = (title: string, year: number, family: string, doi = "10.1/x") => ({
  DOI: doi,
  title: [title],
  issued: { "date-parts": [[year]] },
  author: [{ family }],
});
const openAlexWork = (title: string, year: number, name: string, doi = "https://doi.org/10.2/y") => ({
  doi,
  title,
  publication_year: year,
  authorships: [{ author: { display_name: name } }],
});

/** A fake fetch that answers by URL and records every request. */
function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fn: FetchFn = async (url, init) => {
    urls.push(url);
    headers.push(init?.headers ?? {});
    return handler(url);
  };
  return { fn, urls, headers };
}

const isCrossrefSearch = (u: string) => u.startsWith("https://api.crossref.org/works?");
const isCrossrefDoi = (u: string) => u.startsWith("https://api.crossref.org/works/");
const isOpenAlexSearch = (u: string) => u.startsWith("https://api.openalex.org/works?");
const isOpenAlexDoi = (u: string) => u.startsWith("https://api.openalex.org/works/doi:");

describe("judgeCandidate", () => {
  it("matches on title and first author", () => {
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2017, firstAuthorFamily: "vaswani" }))
      .toEqual({ match: true, yearMismatch: false });
  });

  it("matches but flags a year that is far off (preprint or mirror)", () => {
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2025, firstAuthorFamily: "vaswani" }))
      .toEqual({ match: true, yearMismatch: true });
  });

  it("allows a year one off", () => {
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2018, firstAuthorFamily: "vaswani" }).yearMismatch)
      .toBe(false);
  });

  it("rejects the same title with a different first author", () => {
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2017, firstAuthorFamily: "bishop" }).match)
      .toBe(false);
  });

  it("rejects a different title by the same author", () => {
    expect(judgeCandidate(VASWANI, { title: "Neural machine translation by jointly learning", year: 2017, firstAuthorFamily: "vaswani" }).match)
      .toBe(false);
  });

  it("never matches a one-word title", () => {
    expect(judgeCandidate("Smith (2020). Inflation. Journal.", { title: "Inflation", year: 2020, firstAuthorFamily: "smith" }).match)
      .toBe(false);
  });

  it("without a candidate author, needs the year to back the title up", () => {
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2017, firstAuthorFamily: null }).match).toBe(true);
    expect(judgeCandidate(VASWANI, { title: "Attention Is All You Need", year: 2025, firstAuthorFamily: null }).match).toBe(false);
  });

  it("ignores accents and case", () => {
    expect(
      judgeCandidate("Müller, H. (2018). Price dynamics in open economies. Review.", {
        title: "PRICE DYNAMICS IN OPEN ECONOMIES", year: 2018, firstAuthorFamily: "muller",
      }).match,
    ).toBe(true);
  });
});

describe("titleQueries", () => {
  it("pulls title-like pieces and skips the author list", () => {
    const queries = titleQueries(VASWANI);
    expect(queries).toContain("Attention is all you need");
    expect(queries.some((q) => q.includes("Vaswani"))).toBe(false);
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it("prefers a quoted title", () => {
    const queries = titleQueries('A. Vaswani et al., “Attention is all you need,” in NeurIPS, 2017.');
    expect(queries[0]).toBe("Attention is all you need,");
  });

  it("falls back to the whole entry when nothing title-like is found", () => {
    expect(titleQueries("Smith 2020 x")).toEqual(["Smith 2020 x"]);
  });
});

describe("resolveReference", () => {
  it("finds a reference through Crossref and stops there", async () => {
    const { fn, urls } = fakeFetch((u) =>
      isCrossrefSearch(u) ? crossrefList([crossrefWork("Attention Is All You Need", 2017, "Vaswani", "10.5/abc")]) : json({}, 500),
    );
    const result = await resolveReference(VASWANI, fn);
    expect(result).toMatchObject({ status: "found", resolver: "crossref", doi: "10.5/abc", year: 2017, yearMismatch: false });
    expect(urls).toHaveLength(1);
  });

  it("prefers a candidate whose year fits over one that only matches title and author", async () => {
    const { fn } = fakeFetch((u) =>
      isCrossrefSearch(u)
        ? crossrefList([
            crossrefWork("Attention Is All You Need", 2025, "Vaswani", "10.65/mirror"),
            crossrefWork("Attention Is All You Need", 2017, "Vaswani", "10.5/real"),
          ])
        : json({}, 500),
    );
    const result = await resolveReference(VASWANI, fn);
    expect(result).toMatchObject({ status: "found", doi: "10.5/real", yearMismatch: false });
  });

  it("still counts a reference as found when only a far-year copy exists, and flags the year", async () => {
    const { fn } = fakeFetch((u) =>
      isCrossrefSearch(u) ? crossrefList([crossrefWork("Attention Is All You Need", 2025, "Vaswani")]) : json({}, 500),
    );
    expect(await resolveReference(VASWANI, fn)).toMatchObject({ status: "found", yearMismatch: true });
  });

  it("falls back to OpenAlex when Crossref has nothing", async () => {
    const { fn, urls } = fakeFetch((u) => {
      if (isCrossrefSearch(u)) return crossrefList([]);
      if (isOpenAlexSearch(u)) return openAlexList([openAlexWork("Attention Is All You Need", 2017, "Ashish Vaswani", "https://doi.org/10.48550/arxiv.1706.03762")]);
      return json({}, 500);
    });
    const result = await resolveReference(VASWANI, fn);
    expect(result).toMatchObject({ status: "found", resolver: "openalex", doi: "10.48550/arxiv.1706.03762" });
    expect(urls.some(isOpenAlexSearch)).toBe(true);
  });

  it("returns not_found for an invented reference when both services answer", async () => {
    const invented =
      "Smith, J., & Lee, K. (2021). Quantum inflation dynamics in household spending patterns. Journal of Applied Findings, 12(3), 45-67.";
    const { fn } = fakeFetch((u) =>
      isCrossrefSearch(u)
        ? crossrefList([crossrefWork("Inflation Expectations and Household Spending", 2026, "Candia")])
        : openAlexList([openAlexWork("Remittance Dynamics in Households", 2024, "Someone Else")]),
    );
    expect(await resolveReference(invented, fn)).toEqual({ status: "not_found" });
  });

  it("does not accept a real title that has a different author (an invented attribution)", async () => {
    const entry = "Rahmawati, D. (2019). Pengaruh inflasi terhadap konsumsi rumah tangga di Indonesia. Jurnal Ekonomi.";
    const { fn } = fakeFetch((u) =>
      isCrossrefSearch(u)
        ? crossrefList([crossrefWork("Pengaruh Inflasi terhadap Konsumsi Rumah Tangga di Indonesia", 2025, "Kudadiri")])
        : openAlexList([]),
    );
    expect(await resolveReference(entry, fn)).toEqual({ status: "not_found" });
  });

  it("uses a DOI in the entry directly and makes no search request", async () => {
    const entry = "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444. https://doi.org/10.1038/nature14539";
    const { fn, urls } = fakeFetch((u) =>
      isCrossrefDoi(u) && !isCrossrefSearch(u)
        ? json({ message: crossrefWork("Deep learning", 2015, "LeCun", "10.1038/nature14539") })
        : json({}, 500),
    );
    const result = await resolveReference(entry, fn);
    expect(result).toMatchObject({ status: "found", resolver: "crossref", doi: "10.1038/nature14539" });
    expect(urls).toEqual(["https://api.crossref.org/works/10.1038/nature14539"]);
  });

  it("tries OpenAlex by DOI when Crossref does not know the DOI", async () => {
    const entry = "Author, A. (2020). A study of something specific here. Journal. 10.5555/openalex-only.";
    const { fn, urls } = fakeFetch((u) => {
      if (isCrossrefDoi(u) && !isCrossrefSearch(u)) return json({}, 404);
      if (isOpenAlexDoi(u)) return json(openAlexWork("A study of something specific here", 2020, "A Author", "https://doi.org/10.5555/openalex-only"));
      return json({}, 500);
    });
    const result = await resolveReference(entry, fn);
    expect(result).toMatchObject({ status: "found", resolver: "openalex" });
    expect(urls.some(isOpenAlexDoi)).toBe(true);
  });

  it("ignores a DOI that resolves to an unrelated title, then searches normally", async () => {
    const entry = "Smith, J. (2021). Quantum inflation dynamics in household spending. Journal. 10.1000/unrelated";
    const { fn, urls } = fakeFetch((u) => {
      if (isCrossrefDoi(u) && !isCrossrefSearch(u)) return json({ message: crossrefWork("Protein folding in yeast", 1999, "Jones") });
      if (isCrossrefSearch(u)) return crossrefList([]);
      return openAlexList([]);
    });
    expect(await resolveReference(entry, fn)).toEqual({ status: "not_found" });
    expect(urls.some(isCrossrefSearch)).toBe(true);
  });

  it("returns an error, not not_found, when a lookup fails and nothing matched", async () => {
    const { fn } = fakeFetch((u) => (isCrossrefSearch(u) ? json({}, 503) : openAlexList([])));
    const result = await resolveReference(VASWANI, fn, noSleep);
    expect(result).toEqual({ status: "error", reason: "Crossref returned HTTP 503" });
  });

  it("still finds the reference if one service fails but the other has it", async () => {
    const { fn } = fakeFetch((u) =>
      isCrossrefSearch(u) ? json({}, 429) : openAlexList([openAlexWork("Attention Is All You Need", 2017, "Ashish Vaswani")]),
    );
    expect(await resolveReference(VASWANI, fn, noSleep)).toMatchObject({ status: "found", resolver: "openalex" });
  });

  it("retries once after a 429, waiting as long as Retry-After says", async () => {
    let crossrefCalls = 0;
    const waits: number[] = [];
    const { fn } = fakeFetch((u) => {
      if (!isCrossrefSearch(u)) return openAlexList([]);
      crossrefCalls += 1;
      return crossrefCalls === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "2" } })
        : crossrefList([crossrefWork("Attention Is All You Need", 2017, "Vaswani")]);
    });
    const result = await resolveReference(VASWANI, fn, async (ms) => {
      waits.push(ms);
    });
    expect(result).toMatchObject({ status: "found", resolver: "crossref" });
    expect(crossrefCalls).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it("caps the wait, and uses a default when Retry-After is missing", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const slow = fakeFetch((u) =>
      isCrossrefSearch(u) ? new Response("{}", { status: 429, headers: { "retry-after": "120" } }) : openAlexList([]),
    );
    await resolveReference(VASWANI, slow.fn, sleep);
    const bare = fakeFetch((u) => (isCrossrefSearch(u) ? json({}, 503) : openAlexList([])));
    await resolveReference(VASWANI, bare.fn, sleep);
    expect(waits).toEqual([3000, 1000]);
  });

  it("retries only once, then reports an error", async () => {
    let crossrefCalls = 0;
    const { fn } = fakeFetch((u) => {
      if (isCrossrefSearch(u)) crossrefCalls += 1;
      return isCrossrefSearch(u) ? json({}, 429) : openAlexList([]);
    });
    const result = await resolveReference(VASWANI, fn, noSleep);
    expect(crossrefCalls).toBe(2);
    expect(result).toEqual({ status: "error", reason: "Crossref returned HTTP 429" });
  });

  it("does not retry a 500", async () => {
    const counts = new Map<string, number>();
    const waits: number[] = [];
    const { fn } = fakeFetch((u) => {
      counts.set(u, (counts.get(u) ?? 0) + 1);
      return json({}, 500);
    });
    const result = await resolveReference(VASWANI, fn, async (ms) => {
      waits.push(ms);
    });
    expect(result.status).toBe("error");
    expect(counts.size).toBeGreaterThan(1); // Crossref plus the OpenAlex title searches all ran
    expect([...counts.values()].every((n) => n === 1)).toBe(true); // and none was repeated
    expect(waits).toEqual([]);
  });

  it("does not retry a 404", async () => {
    const counts = new Map<string, number>();
    const entry = "Author, A. (2020). A study of something specific here. Journal. 10.5555/missing-everywhere";
    const { fn } = fakeFetch((u) => {
      counts.set(u, (counts.get(u) ?? 0) + 1);
      return isCrossrefDoi(u) && !isCrossrefSearch(u) ? json({}, 404) : isOpenAlexDoi(u) ? json({}, 404) : isCrossrefSearch(u) ? crossrefList([]) : openAlexList([]);
    });
    expect(await resolveReference(entry, fn, noSleep)).toEqual({ status: "not_found" });
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it("treats a network failure or timeout as an error", async () => {
    const result = await resolveReference(VASWANI, async () => {
      throw new TypeError("fetch failed");
    });
    expect(result.status).toBe("error");
    expect(result).toMatchObject({ reason: expect.stringContaining("could not be reached") });
  });

  it("treats an unexpected response shape as an error", async () => {
    const { fn } = fakeFetch((u) => (isCrossrefSearch(u) ? json({ unexpected: true }) : openAlexList([])));
    expect((await resolveReference(VASWANI, fn)).status).toBe("error");
  });

  it("sends a generic User-Agent and only the reference text", async () => {
    const { fn, urls, headers } = fakeFetch((u) => (isCrossrefSearch(u) ? crossrefList([]) : openAlexList([])));
    await resolveReference(VASWANI, fn);
    for (const h of headers) {
      expect(h["User-Agent"]).toBe("VerifiDocs-portfolio/0.1");
      expect(JSON.stringify(h)).not.toMatch(/@/);
    }
    for (const url of urls) expect(decodeURIComponent(url.replace(/\+/g, " "))).not.toMatch(/mailto|@/i);
  });

  it("never puts error details from the services into the reason", async () => {
    const { fn } = fakeFetch(() => new Response("secret internal detail", { status: 500 }));
    const result = await resolveReference(VASWANI, fn);
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
  });
});
