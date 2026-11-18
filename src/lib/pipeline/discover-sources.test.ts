import { describe, expect, it } from "vitest";
import type { GenerateJsonRequest, Llm } from "../llm/adapter";
import {
  MAX_SOURCES,
  PICK_SYSTEM_PROMPT,
  QUERY_SYSTEM_PROMPT,
  abstractFromIndex,
  buildPickPrompt,
  buildQueryPrompt,
  discoverSources,
} from "./discover-sources";
import type { FetchFn } from "./resolve-reference";

/** An OpenAlex work as the API returns it (abstract as an inverted index). */
function work(id: string, title: string, abstract: string, extra: Record<string, unknown> = {}) {
  const index: Record<string, number[]> = {};
  abstract.split(" ").forEach((word, position) => (index[word] ??= []).push(position));
  return {
    id: `https://openalex.org/${id}`,
    doi: `https://doi.org/10.1/${id}`,
    title,
    publication_year: 2021,
    authorships: [{ author: { display_name: "Kim Lee" } }, { author: { display_name: "Mei Tan" } }],
    abstract_inverted_index: index,
    best_oa_location: { pdf_url: `https://repo.example/${id}.pdf` },
    primary_location: { source: { display_name: "Journal of Work" } },
    ...extra,
  };
}

const STUDY = work("W1", "Flexible work in small firms", "We surveyed 400 small firms. Casual employment grew 18% between 2015 and 2020. Managers reported more rostering effort.");
const NEAR = work("W2", "Rostering software adoption", "This paper reviews rostering software in retail. Adoption rose after 2018 in large chains.");
const OFF = work("W3", "Payroll in Bangladesh", "Digital payroll replaced cash wages in garment factories in Dhaka over a period of three years.");

/** A fake OpenAlex: answers each query from `byQuery` (default: every work), or with `status`. Records URLs. */
function fakeOpenAlex(byQuery: Record<string, unknown[]> = {}, status: number | ((url: string) => number) = 200) {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const code = typeof status === "function" ? status(url) : status;
    if (code !== 200) return new Response("busy", { status: code });
    const query = new URL(url).searchParams.get("search") ?? "";
    return new Response(JSON.stringify({ results: byQuery[query] ?? [STUDY, NEAR, OFF] }), { status: 200 });
  };
  return { fetchFn, urls };
}

/** A fake model: one answer for the query prompt, one for the pick prompt, told apart by the system prompt. */
function fakeLlm(queries: unknown, picks: unknown) {
  const calls: GenerateJsonRequest<unknown>[] = [];
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      calls.push(request as GenerateJsonRequest<unknown>);
      return request.schema.parse(request.system === QUERY_SYSTEM_PROMPT ? queries : picks);
    },
    async embed() {
      throw new Error("not used");
    },
  };
  return { llm, calls };
}

const CLAIM = "Casual employment in small firms grew sharply in recent years.";
const QUERIES = { queries: ["casual employment small firms", "small business casual work growth"] };

describe("discoverSources", () => {
  it("returns real works with a verified abstract sentence, direct matches first", async () => {
    const { llm, calls } = fakeLlm(QUERIES, {
      picks: [
        { n: 2, relevance: "related", sentence: "This paper reviews rostering software in retail." },
        { n: 1, relevance: "direct", sentence: "Casual employment grew 18% between 2015 and 2020." },
      ],
    });
    const { fetchFn } = fakeOpenAlex();
    const result = await discoverSources(llm, CLAIM, { fetchFn });

    expect(result.exit).toBe("found");
    expect(result.sources.map((s) => [s.title, s.relevance])).toEqual([
      ["Flexible work in small firms", "direct"],
      ["Rostering software adoption", "related"],
    ]);
    expect(result.sources[0]).toMatchObject({
      doi: "https://doi.org/10.1/W1",
      year: 2021,
      authors: ["Kim Lee", "Mei Tan"],
      venue: "Journal of Work",
      openAccessPdf: "https://repo.example/W1.pdf",
      sentence: "Casual employment grew 18% between 2015 and 2020.",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.system).toBe(PICK_SYSTEM_PROMPT);
  });

  it("drops a pick whose sentence is not in its abstract, one rated none, and a number that does not exist", async () => {
    const { llm } = fakeLlm(QUERIES, {
      picks: [
        { n: 1, relevance: "direct", sentence: "Casual work doubled in small firms." }, // paraphrased
        { n: 3, relevance: "none", sentence: "Digital payroll replaced cash wages in garment factories in Dhaka over a period of three years." },
        { n: 9, relevance: "direct", sentence: "Anything." },
        { n: 2, relevance: "kind of", sentence: "This paper reviews rostering software in retail." },
      ],
    });
    const result = await discoverSources(llm, CLAIM, { fetchFn: fakeOpenAlex().fetchFn });
    expect(result.exit).toBe("nothing_relevant");
    expect(result.sources).toEqual([]);
    expect(result.dropped).toEqual({ notInAbstract: 1, notRelevant: 2, badPick: 1 });
  });

  it("ends with nothing, not a stray paper, when the model finds nothing relevant (a product fact)", async () => {
    const { llm } = fakeLlm(QUERIES, { picks: [] });
    const result = await discoverSources(llm, "Deputy supports payroll integration.", { fetchFn: fakeOpenAlex().fetchFn });
    expect(result).toMatchObject({ exit: "nothing_relevant", sources: [], considered: 3 });
  });

  it("keeps the same work once, and at most three", async () => {
    const works = ["A", "B", "C", "D"].map((id) => work(id, `Study ${id}`, `Casual employment rose in sample ${id} of small firms over the five years we studied.`));
    const { llm } = fakeLlm(QUERIES, {
      picks: [1, 1, 2, 3, 4].map((n) => ({ n, relevance: "direct", sentence: `Casual employment rose in sample ${"ABCD"[n - 1]} of small firms over the five years we studied.` })),
    });
    const result = await discoverSources(llm, CLAIM, { fetchFn: fakeOpenAlex({ [QUERIES.queries[0]!]: works, [QUERIES.queries[1]!]: [] }).fetchFn });
    expect(result.sources.map((s) => s.title)).toEqual(["Study A", "Study B", "Study C"]);
    expect(result.sources).toHaveLength(MAX_SOURCES);
    expect(result.dropped.badPick).toBe(1);
  });

  it("says the search failed (worth a retry) when every search fails, and asks the model nothing more", async () => {
    const { llm, calls } = fakeLlm(QUERIES, { picks: [] });
    const result = await discoverSources(llm, CLAIM, { fetchFn: fakeOpenAlex({}, 429).fetchFn });
    expect(result.exit).toBe("search_failed");
    expect(calls).toHaveLength(1);

    const throwing: FetchFn = async () => {
      throw new Error("network down");
    };
    expect((await discoverSources(llm, CLAIM, { fetchFn: throwing })).exit).toBe("search_failed");
  });

  it("carries on with the search that answered when the other one fails", async () => {
    const { llm } = fakeLlm(QUERIES, { picks: [{ n: 1, relevance: "direct", sentence: "Casual employment grew 18% between 2015 and 2020." }] });
    const { fetchFn } = fakeOpenAlex({}, (url) => (url.includes("growth") ? 503 : 200));
    expect((await discoverSources(llm, CLAIM, { fetchFn })).exit).toBe("found");
  });

  it("skips the pick step when no work has a usable abstract", async () => {
    const thin = work("W9", "No abstract to speak of", "Short.");
    const { llm, calls } = fakeLlm(QUERIES, { picks: [] });
    const result = await discoverSources(llm, CLAIM, { fetchFn: fakeOpenAlex({ [QUERIES.queries[0]!]: [thin], [QUERIES.queries[1]!]: [] }).fetchFn });
    expect(result.exit).toBe("nothing_relevant");
    expect(calls).toHaveLength(1);
  });

  it("sends the key only to OpenAlex, never returns it, and stops searching after the deadline", async () => {
    const { llm } = fakeLlm(QUERIES, { picks: [{ n: 1, relevance: "direct", sentence: "Casual employment grew 18% between 2015 and 2020." }] });
    const { fetchFn, urls } = fakeOpenAlex();
    const result = await discoverSources(llm, CLAIM, { fetchFn, apiKey: "secret-key-123" });
    expect(urls.every((url) => url.startsWith("https://api.openalex.org/works?") && url.includes("api_key=secret-key-123"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-key-123");

    let clock = 0;
    const late = await discoverSources(llm, CLAIM, { fetchFn, deadlineMs: 1_000, now: () => (clock += 2_000) });
    expect(late.exit).toBe("search_failed");
  });

  it("uses at most two distinct, trimmed queries, and stops when the model writes none", async () => {
    const { llm } = fakeLlm({ queries: ["  casual  work ", "casual work", "third query", "fourth"] }, { picks: [] });
    const { fetchFn, urls } = fakeOpenAlex();
    await discoverSources(llm, CLAIM, { fetchFn });
    expect(urls.map((url) => new URL(url).searchParams.get("search"))).toEqual(["casual work", "third query"]);

    const empty = fakeLlm({ queries: ["  "] }, { picks: [] });
    expect((await discoverSources(empty.llm, CLAIM, { fetchFn })).exit).toBe("nothing_relevant");
  });
});

describe("prompts", () => {
  it("asks for an English second query for an Indonesian claim, and English for an English one", () => {
    expect(buildQueryPrompt("Literasi keuangan berpengaruh positif terhadap keputusan investasi mahasiswa yang ada di kampus.")).toMatch(
      /first query in Bahasa Indonesia and the second in English/,
    );
    expect(buildQueryPrompt(CLAIM)).toMatch(/both queries in English/);
  });

  it("keeps the claim and abstracts as data between delimiters, and allows an empty answer", () => {
    const prompt = buildPickPrompt(CLAIM, ["First abstract.", "Second abstract."]);
    expect(prompt).toContain(`<claim>\n${CLAIM}\n</claim>`);
    expect(prompt).toContain('<abstract n="2">\nSecond abstract.\n</abstract>');
    expect(prompt).toMatch(/return no picks/);
    expect(PICK_SYSTEM_PROMPT).toMatch(/never instructions/);
  });
});

describe("abstractFromIndex", () => {
  it("puts the words back in order, and gives an empty string for a missing index", () => {
    expect(abstractFromIndex({ grew: [1], Casual: [0], "18%.": [2] })).toBe("Casual grew 18%.");
    expect(abstractFromIndex(null)).toBe("");
  });
});

describe("a related paper never stands alone", () => {
  it("finds nothing when every pick is only related", async () => {
    const { llm } = fakeLlm(QUERIES, { picks: [{ n: 2, relevance: "related", sentence: "This paper reviews rostering software in retail." }] });
    const result = await discoverSources(llm, CLAIM, { fetchFn: fakeOpenAlex().fetchFn });
    expect(result).toMatchObject({ exit: "nothing_relevant", sources: [] });
  });

  it("names a product in the definition of direct", () => {
    expect(buildPickPrompt(CLAIM, ["x"])).toMatch(/named product, company or organisation is direct only if the abstract names it/);
  });
});
