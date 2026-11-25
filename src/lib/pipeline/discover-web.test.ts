import { describe, expect, it } from "vitest";
import type { GenerateJsonRequest, Llm } from "../llm/adapter";
import { WebSearchUnavailableError, type WebResult, type WebSearch } from "../web/adapter";
import {
  BLOCKED_SITES,
  MAX_WEB_SOURCES,
  buildWebPickPrompt,
  buildWebQueryPrompt,
  discoverWeb,
  isBlockedSite,
  siteOf,
} from "./discover-web";

const page = (url: string, title: string, content: string): WebResult => ({ url, title, content, score: 0.5 });

const OFFICIAL = page(
  "https://www.acme.example/features",
  "Acme features",
  "Acme is a scheduling tool for small teams. It lets managers publish a weekly rota and track hours worked.",
);
const BLOG = page(
  "https://blog.example.org/acme-review",
  "A review of Acme",
  "Our review: Acme is a scheduling tool for small teams. The pricing is simple and the setup takes ten minutes.",
);

/** A fake model: answers the query prompt and the pick prompt from the script, and records every prompt. */
function fakeLlm(script: { queries?: string[]; picks?: { n: number; relevance?: string; sentence: string }[] }) {
  const prompts: string[] = [];
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      prompts.push(request.prompt);
      if (request.prompt.includes("web search queries")) return request.schema.parse({ queries: script.queries ?? ["acme scheduling", "acme rota"] });
      return request.schema.parse({ picks: script.picks ?? [] });
    },
    async embed() {
      throw new Error("not used");
    },
  };
  return { llm, prompts };
}

/** A fake search service: answers each search from the queue (a list, or an error to throw) and records every call. */
function fakeWeb(...answers: (WebResult[] | Error)[]) {
  const calls: { query: string; options: Parameters<WebSearch["search"]>[1] }[] = [];
  const web: WebSearch = {
    async search(query, options) {
      calls.push({ query, options });
      const answer = answers.shift() ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async extract() {
      throw new Error("not used");
    },
  };
  return { web, calls };
}

describe("siteOf and isBlockedSite", () => {
  it("shows the site without www, and refuses what it cannot read", () => {
    expect(siteOf("https://www.Slack.com/features")).toBe("slack.com");
    expect(siteOf("https://docs.example.org/a")).toBe("docs.example.org");
    expect(siteOf("not a url")).toBeNull();
  });

  it("blocks listed sites and their subdomains, not look-alikes", () => {
    for (const site of ["youtube.com", "m.youtube.com", "scribd.com", "medium.com", "someone.medium.com", "brainly.co.id"]) {
      expect(isBlockedSite(site), site).toBe(true);
    }
    for (const site of ["notyoutube.com", "medium.com.evil.example", "slack.com", "postgresql.org"]) {
      expect(isBlockedSite(site), site).toBe(false);
    }
  });
});

describe("the prompts", () => {
  it("name the second query's language for an Indonesian claim, and ask for a sentence copied exactly", () => {
    expect(buildWebQueryPrompt("Tokopedia adalah platform e-commerce di Indonesia.")).toContain("first query in Bahasa Indonesia and the second in English");
    expect(buildWebQueryPrompt("Slack is a messaging platform.")).toContain("Write both queries in English.");
    const pick = buildWebPickPrompt("a claim", [{ site: "acme.example", title: 'A "quoted" title', content: "Some snippet." }]);
    expect(pick).toContain("copied EXACTLY, character for character");
    expect(pick).toContain("official site");
    expect(pick).toContain('<result n="1" site="acme.example" title="A \'quoted\' title">');
  });
});

describe("discoverWeb", () => {
  it("keeps a direct page with a verified sentence, shows its site, and puts direct before related", async () => {
    const { llm } = fakeLlm({
      picks: [
        { n: 2, relevance: "related", sentence: "The pricing is simple and the setup takes ten minutes." },
        { n: 1, relevance: "direct", sentence: "It lets managers publish a weekly rota and track hours worked." },
      ],
    });
    const { web } = fakeWeb([OFFICIAL], [BLOG]);
    const result = await discoverWeb(llm, web, "Acme lets managers publish a weekly rota.");
    expect(result.exit).toBe("found");
    expect(result.sources).toEqual([
      { url: OFFICIAL.url, site: "acme.example", title: "Acme features", sentence: "It lets managers publish a weekly rota and track hours worked.", relevance: "direct" },
      { url: BLOG.url, site: "blog.example.org", title: "A review of Acme", sentence: "The pricing is simple and the setup takes ten minutes.", relevance: "related" },
    ]);
    expect(result.considered).toBe(2);
  });

  it("never shows a related page alone: nothing direct means nothing found", async () => {
    const { llm } = fakeLlm({ picks: [{ n: 1, relevance: "related", sentence: "Acme is a scheduling tool for small teams." }] });
    const { web } = fakeWeb([OFFICIAL], [BLOG]);
    expect(await discoverWeb(llm, web, "claim")).toMatchObject({ exit: "nothing_relevant", sources: [] });
  });

  it("drops a sentence that is not in the snippet, and counts it (hard rule 1 for web pages)", async () => {
    const { llm } = fakeLlm({
      picks: [
        { n: 1, relevance: "direct", sentence: "Acme is the leading scheduling tool for every team." },
        { n: 2, relevance: "direct", sentence: "Our review: Acme is a scheduling tool for small teams." },
      ],
    });
    const { web } = fakeWeb([OFFICIAL], [BLOG]);
    const result = await discoverWeb(llm, web, "claim");
    expect(result.sources.map((s) => s.site)).toEqual(["blog.example.org"]);
    expect(result.dropped).toEqual({ notInSnippet: 1, notRelevant: 0, badPick: 0 });
  });

  it("counts a bad number, a repeated page and an unknown rating, and keeps nothing from them", async () => {
    const { llm } = fakeLlm({
      picks: [
        { n: 9, relevance: "direct", sentence: "Acme is a scheduling tool for small teams." },
        { n: 1, relevance: "none", sentence: "Acme is a scheduling tool for small teams." },
        { n: 1, sentence: "Acme is a scheduling tool for small teams." },
        { n: 1, relevance: "direct", sentence: "Acme is a scheduling tool for small teams." },
        { n: 1, relevance: "direct", sentence: "Acme is a scheduling tool for small teams." },
      ],
    });
    const { web } = fakeWeb([OFFICIAL], []);
    const result = await discoverWeb(llm, web, "claim");
    expect(result.sources).toHaveLength(1);
    expect(result.dropped).toEqual({ notInSnippet: 0, notRelevant: 2, badPick: 2 });
  });

  it("keeps at most three pages", async () => {
    const many = ["a", "b", "c", "d"].map((x) => page(`https://${x}.example/p`, `Page ${x}`, `Acme page ${x} says that Acme is a scheduling tool for small teams.`));
    const { llm } = fakeLlm({
      picks: many.map((_, i) => ({ n: i + 1, relevance: "direct", sentence: `Acme page ${"abcd"[i]} says that Acme is a scheduling tool for small teams.` })),
    });
    const { web } = fakeWeb(many, []);
    expect((await discoverWeb(llm, web, "claim")).sources).toHaveLength(MAX_WEB_SOURCES);
  });

  it("asks the service to leave out blocked sites, and drops them again if they come back, before the model sees them", async () => {
    const video = page("https://www.youtube.com/watch?v=1", "Acme video", "Acme is a scheduling tool for small teams. Watch the demo to see how it works.");
    const { llm, prompts } = fakeLlm({ picks: [{ n: 1, relevance: "direct", sentence: "It lets managers publish a weekly rota and track hours worked." }] });
    const { web, calls } = fakeWeb([video, OFFICIAL], []);
    const result = await discoverWeb(llm, web, "claim");
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.options?.excludeDomains).toEqual(BLOCKED_SITES);
    const pickPrompt = prompts.find((p) => p.includes("numbered web search results"))!;
    expect(pickPrompt).not.toContain("youtube.com");
    expect(result.sources.map((s) => s.site)).toEqual(["acme.example"]);
  });

  it("keeps at most two pages of one site, and each address once", async () => {
    const same = ["1", "2", "3"].map((n) => page(`https://docs.acme.example/p${n}`, `Doc ${n}`, `Doc ${n}: Acme is a scheduling tool for small teams and more.`));
    const { llm, prompts } = fakeLlm({ picks: [] });
    const { web } = fakeWeb([...same, same[0]!], [same[0]!]);
    const result = await discoverWeb(llm, web, "claim");
    expect(result.considered).toBe(2);
    const pickPrompt = prompts.find((p) => p.includes("numbered web search results"))!;
    expect(pickPrompt.match(/<result n=/g)).toHaveLength(2);
  });

  it("answers nothing found, with no pick call, when no usable page comes back or no query was written", async () => {
    const empty = fakeLlm({});
    expect(await discoverWeb(empty.llm, fakeWeb([], []).web, "claim")).toMatchObject({ exit: "nothing_relevant", considered: 0 });
    expect(empty.prompts).toHaveLength(1); // only the query prompt

    const noQueries = fakeLlm({ queries: ["  ", ""] });
    const web = fakeWeb();
    expect(await discoverWeb(noQueries.llm, web.web, "claim")).toMatchObject({ exit: "nothing_relevant" });
    expect(web.calls).toHaveLength(0);
  });

  it("carries on with one search when the other fails, and throws when both fail", async () => {
    const { llm } = fakeLlm({ picks: [{ n: 1, relevance: "direct", sentence: "Acme is a scheduling tool for small teams." }] });
    const partial = await discoverWeb(llm, fakeWeb(new WebSearchUnavailableError("busy", "busy", 429), [OFFICIAL]).web, "claim");
    expect(partial.exit).toBe("found");

    const quota = new WebSearchUnavailableError("The web search service answered HTTP 432.", "quota", 432);
    const error = await discoverWeb(fakeLlm({}).llm, fakeWeb(quota, new Error("socket hang up")).web, "claim").catch((e: unknown) => e);
    expect(error).toBe(quota); // the first failure, so a quota stays a quota
  });
});
