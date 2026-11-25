import { describe, expect, it } from "vitest";
import {
  WEB_EXTRACT_URL,
  WEB_SEARCH_URL,
  WebSearchUnavailableError,
  cleanUrl,
  createWebSearch,
  loadWebSearchConfig,
  type PostFn,
} from "./adapter";

const KEY = "tvly-test-key-do-not-leak";
const SNIPPET = "A page that says something long enough to count as a usable snippet of text.";

/** A fake POST that records every call and answers with the queued responses (or throws the queued error). */
function fakePost(...answers: (Response | Error)[]) {
  const calls: { url: string; headers: Record<string, string>; body: unknown; timeoutMs: number }[] = [];
  const post: PostFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), timeoutMs: init.timeoutMs });
    const answer = answers.shift() ?? new Error("unexpected call");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { post, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("loadWebSearchConfig", () => {
  it("is off without a key, and on with one", () => {
    expect(loadWebSearchConfig({})).toBeNull();
    expect(loadWebSearchConfig({ TAVILY_API_KEY: "  " })).toBeNull();
    expect(loadWebSearchConfig({ TAVILY_API_KEY: ` ${KEY} ` })).toEqual({ apiKey: KEY });
  });
});

describe("cleanUrl", () => {
  it("keeps http and https, drops the fragment, and refuses everything else", () => {
    expect(cleanUrl("https://example.com/a?b=1#section")).toBe("https://example.com/a?b=1");
    expect(cleanUrl(" http://example.com/x ")).toBe("http://example.com/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com/f", "/relative/path", "not a url", ""]) {
      expect(cleanUrl(bad), bad).toBeNull();
    }
  });
});

describe("search", () => {
  it("sends the key in the Authorization header only, and asks for snippets with safe search", async () => {
    const { post, calls } = fakePost(json({ results: [] }));
    await createWebSearch({ apiKey: KEY }, post).search("workforce scheduling software", { maxResults: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEB_SEARCH_URL);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.body).toMatchObject({
      query: "workforce scheduling software",
      max_results: 4,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      safe_search: true,
    });
  });

  it("keeps good results and drops the ones it cannot use or trust", async () => {
    const { post } = fakePost(
      json({
        results: [
          { url: "https://good.example/a#frag", title: "  Good  page ", content: SNIPPET, score: 0.9 },
          { url: "https://good.example/a", title: "Duplicate of the first", content: SNIPPET, score: 0.8 },
          { url: "javascript:alert(1)", title: "Bad scheme", content: SNIPPET, score: 0.7 },
          { url: "https://empty.example/", title: "", content: SNIPPET, score: 0.7 },
          { url: "https://thin.example/", title: "Thin", content: "too short", score: 0.7 },
          { url: "https://nulls.example/", title: null, content: null },
          { url: "https://other.example/b", title: "Other", content: SNIPPET },
        ],
      }),
    );
    const results = await createWebSearch({ apiKey: KEY }, post).search("q");
    expect(results.map((r) => r.url)).toEqual(["https://good.example/a", "https://other.example/b"]);
    expect(results[0]).toMatchObject({ title: "Good page", score: 0.9 });
    expect(results[1]!.score).toBe(0);
  });

  it("caps a long snippet", async () => {
    const { post } = fakePost(json({ results: [{ url: "https://long.example/", title: "Long", content: "x ".repeat(5_000) }] }));
    const [result] = await createWebSearch({ apiKey: KEY }, post).search("q");
    expect(result!.content.length).toBeLessThanOrEqual(3_000);
  });

  it("answers an empty list when nothing came back, without throwing", async () => {
    const { post } = fakePost(json({ results: [] }));
    expect(await createWebSearch({ apiKey: KEY }, post).search("q")).toEqual([]);
  });

  it("maps each failing status to a reason, and never puts the key or the address in the message", async () => {
    const cases: [number, string][] = [[401, "auth"], [429, "busy"], [434, "busy"], [432, "quota"], [433, "quota"], [500, "failed"], [400, "failed"]];
    for (const [status, reason] of cases) {
      const { post } = fakePost(new Response("nope", { status }));
      const error = await createWebSearch({ apiKey: KEY }, post).search("q").catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(WebSearchUnavailableError);
      expect(error).toMatchObject({ reason, status });
      expect((error as Error).message).not.toContain(KEY);
      expect((error as Error).message).not.toContain("tavily.com");
    }
  });

  it("treats a timeout or a network failure as busy, and a non-JSON or odd answer as failed", async () => {
    const timeout = Object.assign(new Error("The operation timed out with key " + KEY), { name: "TimeoutError" });
    for (const failure of [timeout, new Error("socket hang up")]) {
      const { post } = fakePost(failure);
      const error = await createWebSearch({ apiKey: KEY }, post).search("q").catch((e: unknown) => e);
      expect(error).toMatchObject({ reason: "busy" });
      expect((error as Error).message).not.toContain(KEY);
    }
    for (const bad of [new Response("<html>", { status: 200 }), json({ nothing: true }), json({ results: "no" })]) {
      const { post } = fakePost(bad);
      expect(await createWebSearch({ apiKey: KEY }, post).search("q").catch((e: unknown) => e)).toMatchObject({ reason: "failed" });
    }
  });

  it("sends excluded domains only when there are some, and never more than the service allows", async () => {
    const { post, calls } = fakePost(json({ results: [] }), json({ results: [] }), json({ results: [] }));
    const web = createWebSearch({ apiKey: KEY }, post);
    await web.search("q");
    await web.search("q", { excludeDomains: [] });
    await web.search("q", { excludeDomains: Array.from({ length: 200 }, (_, i) => `site${i}.example`) });
    expect(calls[0]!.body).not.toHaveProperty("exclude_domains");
    expect(calls[1]!.body).not.toHaveProperty("exclude_domains");
    expect((calls[2]!.body as { exclude_domains: string[] }).exclude_domains).toHaveLength(150);
  });

  it("passes the caller's timeout on to the request", async () => {
    const { post, calls } = fakePost(json({ results: [] }), json({ results: [] }));
    const web = createWebSearch({ apiKey: KEY }, post);
    await web.search("q", { timeoutMs: 1_234 });
    await web.search("q");
    expect(calls.map((c) => c.timeoutMs)).toEqual([1_234, 4_500]);
  });
});

describe("extract", () => {
  it("asks for the plain text of one page and returns it", async () => {
    const { post, calls } = fakePost(json({ results: [{ url: "https://page.example/x", raw_content: "  The page text.  " }], failed_results: [] }));
    const page = await createWebSearch({ apiKey: KEY }, post).extract("https://page.example/x#top");
    expect(page).toEqual({ url: "https://page.example/x", text: "The page text." });
    expect(calls[0]!.url).toBe(WEB_EXTRACT_URL);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toEqual({ urls: ["https://page.example/x"], extract_depth: "basic", format: "text" });
  });

  it("answers null for a page it could not read, and for an address it will not send", async () => {
    for (const answer of [
      json({ results: [], failed_results: [{ url: "https://page.example/x", error: "timeout" }] }),
      json({ results: [{ url: "https://page.example/x", raw_content: "   " }] }),
      json({}),
    ]) {
      const { post } = fakePost(answer);
      expect(await createWebSearch({ apiKey: KEY }, post).extract("https://page.example/x")).toBeNull();
    }
    const { post, calls } = fakePost();
    expect(await createWebSearch({ apiKey: KEY }, post).extract("javascript:alert(1)")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("caps a very long page and maps a failing status like search does", async () => {
    const { post } = fakePost(json({ results: [{ url: "https://page.example/x", raw_content: "word ".repeat(50_000) }] }));
    const page = await createWebSearch({ apiKey: KEY }, post).extract("https://page.example/x");
    expect(page!.text.length).toBeLessThanOrEqual(60_000);
    const failing = fakePost(new Response("", { status: 432 }));
    expect(await createWebSearch({ apiKey: KEY }, failing.post).extract("https://page.example/x").catch((e: unknown) => e)).toMatchObject({ reason: "quota", status: 432 });
  });
});
