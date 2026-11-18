import { describe, expect, it } from "vitest";
import { ApiClientError, createApi } from "./api";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const retryBody = (code: string) => ({ error: { code, message: "Try again.", retry: true } });

/** A scripted fetch: each call takes the next reply (a Response, or an Error to throw). */
function scripted(replies: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const next = replies.shift();
    if (!next) throw new Error("no reply scripted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function harness(replies: (Response | Error)[], extra: { maxAttempts?: number } = {}) {
  const { fetchImpl, calls } = scripted(replies);
  const waits: number[] = [];
  const waking: boolean[] = [];
  const api = createApi({
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
    onWaking: (value) => waking.push(value),
    ...extra,
  });
  return { api, calls, waits, waking };
}

describe("createApi: one session", () => {
  /** A fetch whose replies are released by hand, so the test controls when each request finishes. */
  function manual() {
    const started: string[] = [];
    const release: ((reply: Response) => void)[] = [];
    const fetchImpl = ((url: RequestInfo | URL) => {
      started.push(String(url));
      return new Promise<Response>((resolve) => release.push(resolve));
    }) as typeof fetch;
    return { api: createApi({ fetchImpl, sleep: async () => {} }), started, release };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends the first request alone: a second one waits until the first has finished and its cookie is set", async () => {
    const { api, started, release } = manual();
    const first = api.listSources();
    const second = api.listSources();
    await tick();
    expect(started).toEqual(["/api/sources"]); // only the first is on its way

    release[0]!(json({ sources: [] }));
    await first;
    await tick();
    expect(started).toHaveLength(2); // now the second goes
    release[1]!(json({ sources: [] }));
    await second;
  });

  it("holds a create-run request, and an event, until the opening request is done", async () => {
    const { api, started, release } = manual();
    const opening = api.listSources();
    const create = api.createRun({ draft: { kind: "paste", text: "A claim." }, references: "" });
    const event = api.event("fix_accepted");
    await tick();
    expect(started).toEqual(["/api/sources"]);

    release[0]!(json({ sources: [] }));
    await opening;
    await tick();
    expect(started.sort()).toEqual(["/api/events", "/api/runs", "/api/sources"]);
    release[1]!(json({ runId: "r1", status: "extracting", unitCount: 1, referenceCount: 0 }, 201));
    release[2]!(new Response(null, { status: 204 }));
    await create;
    await event;
  });

  it("does not wait for ever when the opening request fails", async () => {
    const calls: string[] = [];
    let first = true;
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (first) {
        first = false;
        throw new TypeError("network down");
      }
      return json({ sources: [] });
    }) as typeof fetch;
    const api = createApi({ fetchImpl, sleep: async () => {}, maxAttempts: 1 });
    const failing = api.listSources().catch((error) => error);
    const next = api.listSources();
    expect(await failing).toBeInstanceOf(ApiClientError);
    expect(await next).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("adds no delay once the first request has finished", async () => {
    const { api, started, release } = manual();
    const first = api.listSources();
    release[0]!(json({ sources: [] }));
    await first;
    const second = api.listSources();
    const third = api.listSources();
    await tick();
    expect(started).toHaveLength(3); // both start at once, nothing is held back any more
    release[1]!(json({ sources: [] }));
    release[2]!(json({ sources: [] }));
    await Promise.all([second, third]);
  });
});

describe("createApi: requests", () => {
  it("sends JSON with the same-origin cookie and returns the parsed body", async () => {
    const { api, calls } = harness([json({ runId: "r1", status: "extracting", unitCount: 1, referenceCount: 2 }, 201)]);
    const reply = await api.createRun({ draft: { kind: "paste", text: "A claim." }, references: "" });
    expect(reply.runId).toBe("r1");
    expect(calls[0]!.url).toBe("/api/runs");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ draft: "A claim." });
  });

  it("includes the reference list only when one was typed", async () => {
    const { api, calls } = harness([json({ runId: "r" }, 201)]);
    await api.createRun({ draft: { kind: "paste", text: "x" }, references: "  Smith (2020). A title. J.  " });
    expect(JSON.parse(calls[0]!.init!.body as string).references).toContain("Smith (2020)");
  });

  it("sends a .docx as multipart form data", async () => {
    const { api, calls } = harness([json({ runId: "r" }, 201)]);
    await api.createRun({ draft: { kind: "docx", file: new File(["x"], "draft.docx") }, references: "ref text here" });
    const form = calls[0]!.init!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("draft.docx");
    expect(form.get("references")).toBe("ref text here");
  });

  it("returns nothing for a 204 delete, and lists sources", async () => {
    const { api } = harness([new Response(null, { status: 204 }), json({ sources: [{ id: "s1" }] })]);
    await expect(api.deleteSource("s1")).resolves.toBeUndefined();
    expect(await api.listSources()).toEqual([{ id: "s1" }]);
  });

  it("uploads a file as multipart under the name 'file'", async () => {
    const { api, calls } = harness([json({ documentId: "d", status: "ingesting", pageCount: 3 }, 201)]);
    await api.upload(new File(["%PDF-"], "paper.pdf"));
    expect((calls[0]!.init!.body as FormData).get("file")).toBeInstanceOf(File);
  });
});

describe("createApi: retries", () => {
  it("retries a 503 marked retry, honouring Retry-After, and reports the database waking up then recovered", async () => {
    const { api, waits, waking, calls } = harness([
      json(retryBody("database_waking"), 503, { "retry-after": "3" }),
      json(retryBody("database_waking"), 503, { "retry-after": "3" }),
      json({ sources: [] }),
    ]);
    expect(await api.listSources()).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([3000, 3000]);
    expect(waking).toEqual([true, true, false]);
  });

  it("backs off exponentially without a Retry-After, up to a cap", async () => {
    const replies = [1, 2, 3, 4, 5].map(() => json(retryBody("model_unavailable"), 503));
    const { api, waits } = harness([...replies, json({ unit: 0 })]);
    await api.extract("r", 0);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("retries a network failure and gives up with a plain message after the last attempt", async () => {
    const { api, calls } = harness([new TypeError("fetch failed"), new TypeError("fetch failed")], { maxAttempts: 2 });
    await expect(api.getRun("r")).rejects.toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(2);
  });

  it("recovers when a network failure is followed by success", async () => {
    const { api } = harness([new TypeError("offline"), json({ sources: [] })]);
    expect(await api.listSources()).toEqual([]);
  });

  it("does not retry other errors, and surfaces the server's code and message", async () => {
    const { api, calls } = harness([json({ error: { code: "empty", message: "The draft is empty." } }, 400)]);
    const failure = await api.createRun({ draft: { kind: "paste", text: " " }, references: "" }).catch((e) => e);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({ status: 400, code: "empty", message: "The draft is empty." });
    expect(calls).toHaveLength(1);
  });

  it("does not retry a 503 that is not marked retry, nor a 500", async () => {
    const a = harness([json({ error: { code: "x", message: "m" } }, 503)]);
    await expect(a.api.getRun("r")).rejects.toMatchObject({ status: 503 });
    expect(a.calls).toHaveLength(1);
    const b = harness([json({ error: { code: "internal", message: "m" } }, 500)]);
    await expect(b.api.getRun("r")).rejects.toMatchObject({ status: 500 });
    expect(b.calls).toHaveLength(1);
  });

  it("gives a generic error for a non-JSON error body", async () => {
    const { api } = harness([new Response("<html>bad gateway</html>", { status: 502 })]);
    await expect(api.getRun("r")).rejects.toMatchObject({ status: 502, code: "error" });
  });

  it("gives up on a stuck 503 after the allowed attempts", async () => {
    const { api, calls } = harness([1, 2, 3].map(() => json(retryBody("model_unavailable"), 503)), { maxAttempts: 3 });
    await expect(api.getRun("r")).rejects.toMatchObject({ status: 503, code: "model_unavailable" });
    expect(calls).toHaveLength(3);
  });
});

describe("createApi: events", () => {
  it("posts an event and never throws, even if the request fails", async () => {
    const ok = harness([new Response(null, { status: 204 })]);
    await ok.api.event("evidence_opened", { verdict: "supported" });
    expect(JSON.parse(ok.calls[0]!.init!.body as string)).toEqual({ name: "evidence_opened", props: { verdict: "supported" } });

    const failing = harness([new TypeError("offline")]);
    await expect(failing.api.event("fix_accepted")).resolves.toBeUndefined();
  });
});
