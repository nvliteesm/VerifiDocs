import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import { LlmOutputError, LlmUnavailableError } from "../llm/adapter";
import { WebSearchUnavailableError } from "../web/adapter";
import { DraftError } from "../pipeline/parse-draft";
import { IngestError } from "../pipeline/ingest";
import { ApiError, assertId, assertSameOrigin, errorResponse, readJson, readUpload } from "./http";

const post = (headers: Record<string, string> = {}, body: BodyInit | null = null, url = "https://app.example/api/x") =>
  new Request(url, { method: "POST", headers, body });

async function bodyOf(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; retry?: boolean } };
}

describe("assertSameOrigin", () => {
  it("allows a same-site write, a write with no Origin, and any read", () => {
    expect(() => assertSameOrigin(post({ origin: "https://app.example", host: "app.example" }))).not.toThrow();
    expect(() => assertSameOrigin(post({}))).not.toThrow();
    expect(() => assertSameOrigin(new Request("https://app.example/api/x", { headers: { origin: "https://evil.example" } }))).not.toThrow();
  });

  it("refuses a write from another site, and a malformed or 'null' origin", () => {
    for (const origin of ["https://evil.example", "null", "not a url"]) {
      expect(() => assertSameOrigin(post({ origin, host: "app.example" }))).toThrow(ApiError);
    }
  });

  it("compares against the forwarded host behind a proxy", () => {
    expect(() =>
      assertSameOrigin(post({ origin: "https://app.example", host: "internal:3000", "x-forwarded-host": "app.example" })),
    ).not.toThrow();
  });

  it("covers PUT, PATCH and DELETE too", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const request = new Request("https://app.example/api/x", { method, headers: { origin: "https://evil.example", host: "app.example" } });
      expect(() => assertSameOrigin(request)).toThrow(ApiError);
    }
  });
});

describe("readJson", () => {
  const json = (body: string, headers: Record<string, string> = {}) =>
    post({ "content-type": "application/json", ...headers }, body);

  it("parses JSON", async () => {
    expect(await readJson(json('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses a non-JSON type, invalid JSON, and a body over the limit", async () => {
    await expect(readJson(post({ "content-type": "text/plain" }, "x"))).rejects.toMatchObject({ status: 415 });
    await expect(readJson(json("{not json"))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
    await expect(readJson(json('{"a":"' + "x".repeat(100) + '"}'), 50)).rejects.toMatchObject({ status: 413 });
  });

  it("counts bytes, not characters, against the limit", async () => {
    await expect(readJson(json(JSON.stringify({ a: "é".repeat(40) })), 60)).rejects.toMatchObject({ status: 413 });
  });
});

describe("readUpload", () => {
  const form = (file: File | null) => {
    const data = new FormData();
    if (file) data.set("file", file);
    data.set("references", "x");
    return new Request("https://app.example/api/x", { method: "POST", body: data });
  };

  it("returns the file's bytes and name, and the other fields", async () => {
    const upload = await readUpload(form(new File([new Uint8Array([1, 2, 3])], "paper.pdf")), "file", 1000);
    expect([...upload.bytes]).toEqual([1, 2, 3]);
    expect(upload.filename).toBe("paper.pdf");
    expect(upload.form.get("references")).toBe("x");
  });

  it("refuses a missing file, an oversized file and a non-multipart request", async () => {
    await expect(readUpload(form(null), "file", 1000)).rejects.toMatchObject({ code: "missing_file" });
    await expect(readUpload(form(new File([new Uint8Array(2000)], "big.pdf")), "file", 1000)).rejects.toMatchObject({ status: 413 });
    await expect(readUpload(post({ "content-type": "application/json" }, "{}"), "file", 1000)).rejects.toMatchObject({ status: 415 });
  });
});

describe("assertId", () => {
  it("accepts a UUID and refuses anything else as a plain 404", () => {
    expect(assertId("0b9d8a52-7f0e-4a6a-9d0c-6f1f7a3c2b11")).toBe("0b9d8a52-7f0e-4a6a-9d0c-6f1f7a3c2b11");
    for (const bad of ["", "abc", "1; drop table runs", "0b9d8a52-7f0e-4a6a-9d0c-6f1f7a3c2b1", "../etc/passwd"]) {
      let caught: unknown;
      try {
        assertId(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught, bad).toMatchObject({ status: 404, code: "not_found" });
    }
  });
});

describe("errorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps known errors to their status and a safe body", async () => {
    const cases: [unknown, number, string][] = [
      [new ApiError(403, "bad_origin", "No."), 403, "bad_origin"],
      [new DraftError("empty", "The draft is empty."), 400, "empty"],
      [new DraftError("too_long", "Too long."), 400, "too_long"],
      [new IngestError("too_large", "Large."), 413, "too_large"],
      [new IngestError("not_a_pdf", "No."), 415, "not_a_pdf"],
      [new IngestError("unreadable", "No."), 422, "unreadable"],
      [new IngestError("too_many_documents", "No."), 409, "too_many_documents"],
      [new IngestError("not_found", "No."), 404, "not_found"],
      [new ZodError([]), 400, "invalid_request"],
    ];
    for (const [error, status, code] of cases) {
      const response = errorResponse(error);
      expect(response.status).toBe(status);
      expect((await bodyOf(response)).error.code).toBe(code);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers 503 with a retry hint when the model is unavailable or answered badly", async () => {
    for (const error of [new LlmUnavailableError("down", 503), new LlmOutputError("bad")]) {
      const response = errorResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(await bodyOf(response)).toMatchObject({ error: { code: "model_unavailable", retry: true } });
    }
  });

  it("answers 503 with its own code and no retry hint when the credits are used up (HTTP 402)", async () => {
    const response = errorResponse(new LlmUnavailableError("The Gemini API request failed (HTTP 402).", 402));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    const body = await bodyOf(response);
    expect(body.error.code).toBe("model_quota");
    expect(body.error).not.toHaveProperty("retry");
    // A busy model (429, 503) or a timeout (no status) is still worth another try.
    for (const status of [429, 503, undefined]) {
      expect(await bodyOf(errorResponse(new LlmUnavailableError("x", status)))).toMatchObject({ error: { code: "model_unavailable", retry: true } });
    }
  });

  it("answers a web search failure with its own code: a busy one is retried, an exhausted or unavailable one is not", async () => {
    const cases = [
      ["busy", "web_busy", true],
      ["quota", "web_quota", false],
      ["auth", "web_unavailable", false],
      ["failed", "web_unavailable", false],
    ] as const;
    for (const [reason, code, retry] of cases) {
      const response = errorResponse(new WebSearchUnavailableError("The web search service failed.", reason, 500));
      expect(response.status, reason).toBe(503);
      const body = await bodyOf(response);
      expect(body.error.code, reason).toBe(code);
      if (retry) {
        expect(response.headers.get("retry-after")).toBe("2");
        expect(body.error.retry).toBe(true);
      } else {
        expect(response.headers.get("retry-after")).toBeNull();
        expect(body.error).not.toHaveProperty("retry");
      }
      expect(JSON.stringify(body)).not.toContain("The web search service failed.");
    }
  });

  it("answers 503 with a retry hint while the database is waking up", async () => {
    for (const code of ["CONNECT_TIMEOUT", "ECONNREFUSED", "57P03", "CONNECTION_CLOSED"]) {
      const response = errorResponse(Object.assign(new Error("x"), { code }));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("3");
      expect(await bodyOf(response)).toMatchObject({ error: { code: "database_waking", retry: true } });
    }
  });

  it("never echoes or logs the message of an unexpected error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "the student's private sentence";
    const response = errorResponse(Object.assign(new Error(`boom: ${secret}`), { code: "XX000" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await bodyOf(response))).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).toContain("XX000");
  });

  it("handles a thrown non-Error value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(errorResponse("a string").status).toBe(500);
    expect(errorResponse(undefined).status).toBe(500);
  });

  it("a real zod failure is mapped without leaking the input", async () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 42, secret: "private" });
    expect(parsed.success).toBe(false);
    const response = errorResponse((parsed as { error: ZodError }).error);
    expect(JSON.stringify(await bodyOf(response))).not.toContain("private");
  });
});
