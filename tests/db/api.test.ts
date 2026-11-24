// The API handlers against the Neon `dev` branch, driven with real Request objects and a fake model client.
// Skipped unless NEON_BRANCH=dev. Each test runs in a transaction that is rolled back.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkClaimHandler, postEvent } from "../../src/lib/api/claims";
import { handleWith, type ApiContext, type ApiDeps } from "../../src/lib/api/handler";
import { MAX_RUNS_PER_SESSION, createRun, deleteRun, extractUnit, getRun } from "../../src/lib/api/runs";
import { importDraft } from "../../src/lib/api/imports";
import { attachSourceHandler, findSourcesHandler } from "../../src/lib/api/sources-found";
import { PdfFetchError } from "../../src/lib/pipeline/fetch-pdf";
import type { DiscoverResult } from "../../src/lib/pipeline/discover-sources";
import { deleteSource, ingestSource, listSources, uploadSource } from "../../src/lib/api/sources";
import {
  EMBEDDING_DIMENSIONS,
  LlmOutputError,
  LlmUnavailableError,
  type GenerateJsonRequest,
  type Llm,
} from "../../src/lib/llm/adapter";
import type { ReferenceResolution } from "../../src/lib/pipeline/resolve-reference";
import { DEFAULT_LIMITS, type Limits } from "../../src/lib/rate-limit";
import { hashToken } from "../../src/lib/session";

const url = process.env.DATABASE_URL_UNPOOLED;
const enabled = Boolean(url) && process.env.NEON_BRANCH === "dev";

class Rollback extends Error {}
const sql = enabled ? postgres(url as string, { max: 1, onnotice: () => {} }) : null;

async function inTx(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
  if (!sql) return;
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));
const probe = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

interface Script {
  extract?: (prompt: string) => { claims: { text: string; citation: string | null }[] };
  judge?: () => unknown;
  fix?: () => string;
}

function fakeLlm(script: Script = {}) {
  const calls = { extract: 0, judge: 0, fix: 0 };
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      if (request.prompt.includes("list the claims about the outside world")) {
        calls.extract += 1;
        if (!script.extract) throw new Error("unexpected extraction call");
        return request.schema.parse(script.extract(request.prompt));
      }
      if (request.prompt.includes("Decide whether the passages support the claim")) {
        calls.judge += 1;
        if (!script.judge) throw new Error("unexpected judge call");
        return request.schema.parse(script.judge());
      }
      calls.fix += 1;
      return request.schema.parse({ sentence: script.fix ? script.fix() : "" });
    },
    async embed(texts) {
      return texts.map(() => [...probe]);
    },
  };
  return { llm, calls };
}

interface Reply {
  status: number;
  body: any;
  setCookie: string | null;
  retryAfter: string | null;
}

/** One simulated browser: it keeps its own cookie, like a real session would. */
function newClient(
  tx: postgres.TransactionSql,
  llm: Llm,
  resolve?: ApiDeps["resolve"],
  limits?: Limits,
  fetchImpl?: typeof fetch,
  discover?: ApiDeps["discover"],
  fetchPdfImpl?: ApiDeps["fetchPdf"],
) {
  const deps: ApiDeps = {
    sql: tx,
    llm,
    ...(resolve ? { resolve } : {}),
    ...(limits ? { limits } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(discover ? { discover } : {}),
    ...(fetchPdfImpl ? { fetchPdf: fetchPdfImpl } : {}),
  };
  const client = {
    cookie: null as string | null,
    async send(
      method: string,
      path: string,
      fn: (context: ApiContext, request: Request) => Promise<Response>,
      options: { json?: unknown; form?: FormData; headers?: Record<string, string>; rawBody?: string; model?: boolean; imports?: boolean } = {},
    ): Promise<Reply> {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      if (client.cookie) headers.cookie = client.cookie;
      let body: BodyInit | null = null;
      if (options.json !== undefined) {
        headers["content-type"] = headers["content-type"] ?? "application/json";
        body = JSON.stringify(options.json);
      } else if (options.rawBody !== undefined) {
        body = options.rawBody;
      } else if (options.form) {
        body = options.form;
      }
      const request = new Request(`http://localhost:3000${path}`, { method, headers, body });
      const response = await handleWith(deps, request, (context) => fn(context, request), {
        ...(options.model ? { model: true } : {}),
        ...(options.imports ? { imports: true } : {}),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) client.cookie = setCookie.split(";")[0]!;
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        setCookie,
        retryAfter: response.headers.get("retry-after"),
      };
    },
    createRun: (json: unknown, headers?: Record<string, string>) =>
      client.send("POST", "/api/runs", (c, r) => createRun(c, r), { json, ...(headers ? { headers } : {}) }),
    createRunForm: (form: FormData) => client.send("POST", "/api/runs", (c, r) => createRun(c, r), { form }),
    extract: (runId: string, unit: number, mode?: "read" | "skip" | "retry") =>
      client.send("POST", `/api/runs/${runId}/extract`, (c, r) => extractUnit(c, runId, r), { json: mode ? { unit, mode } : { unit }, model: true }),
    getRun: (runId: string) => client.send("GET", `/api/runs/${runId}`, (c) => getRun(c, runId)),
    deleteRun: (runId: string) => client.send("DELETE", `/api/runs/${runId}`, (c) => deleteRun(c, runId)),
    listSources: () => client.send("GET", "/api/sources", (c) => listSources(c)),
    upload: (form: FormData) => client.send("POST", "/api/sources", (c, r) => uploadSource(c, r), { form }),
    ingest: (id: string) => client.send("POST", `/api/sources/${id}/ingest`, (c) => ingestSource(c, id), { model: true }),
    deleteSource: (id: string) => client.send("DELETE", `/api/sources/${id}`, (c) => deleteSource(c, id)),
    attach: (claimId: string, rank: number, form?: FormData) =>
      client.send("POST", `/api/claims/${claimId}/sources/${rank}/attach`, (c, r) => attachSourceHandler(c, claimId, String(rank), r), {
        ...(form ? { form } : { json: {} }),
        model: true,
      }),
    findSources: (claimId: string) =>
      client.send("POST", `/api/claims/${claimId}/sources`, (c) => findSourcesHandler(c, claimId), { model: true }),
    check: (claimId: string) =>
      client.send("POST", `/api/claims/${claimId}/check`, (c) => checkClaimHandler(c, claimId), { model: true }),
    event: (json: unknown) => client.send("POST", "/api/events", (c, r) => postEvent(c, r), { json }),
    sessionId: async () => {
      const token = client.cookie!.split("=")[1]!;
      const [row] = await tx<{ id: string }[]>`select id from sessions where token_hash = ${hashToken(token)}`;
      return row!.id;
    },
  };
  return client;
}

const pdfForm = (name: string, filename = "paper.pdf") => {
  const form = new FormData();
  form.set("file", new File([fixture(name)], filename, { type: "application/pdf" }));
  return form;
};

const DRAFT =
  "Inflation rose to 5 percent in 2023 (Smith, 2021).\n\nReferences\n\n" +
  "Smith, J. (2021). Inflation and household spending. Journal of Economics.\n\n" +
  "Lee, K. (2020). Consumer behaviour. Review.";

const singleClaim = () => ({ claims: [{ text: "Inflation rose to 5 percent in 2023", citation: "(Smith, 2021)" }] });

async function events(tx: postgres.TransactionSql, sessionId: string) {
  return tx<{ name: string; props: any }[]>`select name, props from events where session_id = ${sessionId} order by id`;
}

async function countSessions(tx: postgres.TransactionSql): Promise<number> {
  const [row] = await tx<{ n: number }[]>`select count(*)::int as n from sessions`;
  return row!.n;
}

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("session and cookie", () => {
  it("starts a session with a safe cookie on the first request, and reuses it afterwards", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const first = await client.listSources();
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ sources: [] });
      expect(first.setCookie).toMatch(/^vd_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);

      const second = await client.listSources();
      expect(second.setCookie).toBeNull();

      const started = await events(tx, await client.sessionId());
      expect(started.map((e) => e.name)).toEqual(["session_started"]);
    });
  });

  it("stores only a hash of the token", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      await client.listSources();
      const token = client.cookie!.split("=")[1]!;
      expect(await tx`select token_hash from sessions where token_hash = ${token}`).toHaveLength(0);
      expect(await tx`select 1 from sessions where token_hash = ${hashToken(token)}`).toHaveLength(1);
    });
  });

  it("gives an unknown or malformed cookie a fresh, empty session and never another session's data", async () => {
    await inTx(async (tx) => {
      const owner = newClient(tx, fakeLlm().llm);
      await owner.upload(pdfForm("sample.pdf"));
      expect((await owner.listSources()).body.sources).toHaveLength(1);

      for (const cookie of [`vd_session=${"A".repeat(43)}`, "vd_session=not-a-token", "vd_session="]) {
        const stranger = newClient(tx, fakeLlm().llm);
        stranger.cookie = cookie;
        const reply = await stranger.listSources();
        expect(reply.status).toBe(200);
        expect(reply.setCookie).not.toBeNull();
        expect(reply.body.sources).toEqual([]);
      }
    });
  });

  it("refuses a write from another site before doing anything, and allows a same-site one", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const before = await countSessions(tx);
      const refused = await client.createRun({ draft: DRAFT }, { origin: "https://evil.example" });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("bad_origin");
      expect(await countSessions(tx)).toBe(before);

      const allowed = await client.createRun({ draft: DRAFT }, { origin: "http://localhost:3000" });
      expect(allowed.status).toBe(201);
    });
  });
});

describe.skipIf(!enabled)("creating a run", () => {
  it("saves a pasted draft without its reference list, the references in order, and ids-only events", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const reply = await client.createRun({ draft: DRAFT });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ status: "extracting", unitCount: 1, referenceCount: 2 });

      const [run] = await tx`select status, unit_count, draft_text, input_type from runs where id = ${reply.body.runId}`;
      expect(run).toMatchObject({ status: "extracting", unit_count: 1, input_type: "paste" });
      expect(run!.draft_text).toContain("Inflation rose to 5 percent");
      expect(run!.draft_text).not.toContain("Lee, K.");

      const refs = await tx`select position, raw_text from reference_entries where run_id = ${reply.body.runId} order by position`;
      expect(refs.map((r) => r.position)).toEqual([1, 2]);
      expect(refs[0]!.raw_text).toBe("Smith, J. (2021). Inflation and household spending. Journal of Economics.");

      const logged = await events(tx, await client.sessionId());
      expect(logged.map((e) => e.name)).toEqual(["session_started", "draft_submitted", "references_added"]);
      expect(logged[1]!.props).toEqual({ input_type: "paste", length_bucket: "short" });
      expect(logged[2]!.props).toEqual({ count: 2 });
      expect(JSON.stringify(logged)).not.toContain("Inflation");
    });
  });

  it("uses a separately supplied reference list instead of one inside the draft", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const reply = await client.createRun({
        draft: "Plain text with no references heading in it.",
        references: "1. Jones, A. (2019). A title here. Journal.\n2. Brown, T. (2018). Another title. Review.",
      });
      expect(reply.body.referenceCount).toBe(2);
      const refs = await tx`select raw_text from reference_entries where run_id = ${reply.body.runId} order by position`;
      expect(refs.map((r) => r.raw_text)).toEqual(["Jones, A. (2019). A title here. Journal.", "Brown, T. (2018). Another title. Review."]);
    });
  });

  it("reads a .docx draft and its reference list", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const form = new FormData();
      form.set("file", new File([fixture("sample.docx")], "draft.docx"));
      const reply = await client.createRunForm(form);
      expect(reply.status).toBe(201);
      expect(reply.body.referenceCount).toBe(2);
      const logged = await events(tx, await client.sessionId());
      expect(logged.find((e) => e.name === "draft_submitted")!.props.input_type).toBe("docx");
    });
  });

  it("allows a draft with no reference list", async () => {
    await inTx(async (tx) => {
      const reply = await newClient(tx, fakeLlm().llm).createRun({ draft: "Just a sentence about rates in 2020." });
      expect(reply.status).toBe(201);
      expect(reply.body.referenceCount).toBe(0);
    });
  });

  it("rejects bad input with a clear code", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      expect((await client.createRun({ draft: "   " })).body.error.code).toBe("empty");
      expect((await client.createRun({ draft: 5 })).body.error.code).toBe("invalid_request");
      expect((await client.createRun({ nothing: true })).status).toBe(400);
      const wrongType = await client.send("POST", "/api/runs", (c, r) => createRun(c, r), { rawBody: "x", headers: { "content-type": "text/plain" } });
      expect(wrongType.status).toBe(415);
      const tooLong = await client.createRun({ draft: "word ".repeat(51_000) }); // 255,000 characters, over the 250,000 limit
      expect(tooLong.body.error.code).toBe("too_long");
    });
  });

  it("keeps a full session usable by dropping its oldest check, never refusing the student", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      await client.listSources();
      const sessionId = await client.sessionId();
      for (let i = 0; i < MAX_RUNS_PER_SESSION; i += 1) {
        await tx`
          insert into runs (session_id, draft_text, input_type, created_at)
          values (${sessionId}, ${`old-${i}`}, 'paste', now() - make_interval(mins => ${MAX_RUNS_PER_SESSION - i}))`;
      }
      const reply = await client.createRun({ draft: DRAFT });
      expect(reply.status).toBe(201);

      const rows = await tx<{ draft_text: string }[]>`select draft_text from runs where session_id = ${sessionId}`;
      expect(rows).toHaveLength(MAX_RUNS_PER_SESSION);
      const kept = new Set(rows.map((row) => row.draft_text));
      expect(kept.has("old-0")).toBe(false); // the oldest went
      expect(kept.has("old-1")).toBe(true);
      expect(kept.has(`old-${MAX_RUNS_PER_SESSION - 1}`)).toBe(true); // the newest old one stayed
    });
  });

  it("does not touch another session's checks when pruning", async () => {
    await inTx(async (tx) => {
      const other = newClient(tx, fakeLlm().llm);
      await other.listSources();
      const otherId = await other.sessionId();
      await tx`insert into runs (session_id, draft_text, input_type) values (${otherId}, 'theirs', 'paste')`;

      const mine = newClient(tx, fakeLlm().llm);
      await mine.listSources();
      const myId = await mine.sessionId();
      for (let i = 0; i < MAX_RUNS_PER_SESSION; i += 1) {
        await tx`insert into runs (session_id, draft_text, input_type) values (${myId}, 'x', 'paste')`;
      }
      expect((await mine.createRun({ draft: DRAFT })).status).toBe(201);
      const [theirs] = await tx<{ n: number }[]>`select count(*)::int as n from runs where session_id = ${otherId}`;
      expect(theirs!.n).toBe(1);
    });
  });

  it("says 'too long' for an over-limit draft of 4-byte characters, not 'request too large'", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const over = await client.createRun({ draft: "\u{1F600}".repeat(130_000) }); // 260,000 UTF-16 units, 520 KB
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe("too_long");
    });
  });

  it("accepts a draft at the character limit together with a long reference list", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const draft = "中".repeat(249_000); // 3 bytes each in UTF-8, about 747 KB
      const refs = Array.from({ length: 450 }, (_, i) => `Author${i}, A. (2020). ${"A long title ".repeat(8)}${i}. Journal.`).join("\n");
      const reply = await client.createRun({ draft, references: refs });
      expect(reply.status).toBe(201);
      expect(reply.body.referenceCount).toBe(450);
    });
  });

  it("rejects a reference list over the limit instead of silently cutting it", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const refs = Array.from({ length: 501 }, (_, i) => `Author${i}, A. (2020). Title number ${i}. Journal.`).join("\n");
      const reply = await client.createRun({ draft: DRAFT, references: refs });
      expect(reply.status).toBe(400);
      expect(reply.body.error.code).toBe("too_many_references");
      expect(reply.body.error.message).toMatch(/501 entries/);
    });
  });
});

describe.skipIf(!enabled)("deleting a check", () => {
  it("removes the draft, claims and reference entries now, keeps the session, and keeps only id-and-count events", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: singleClaim }).llm);
      const created = await client.createRun({ draft: DRAFT });
      const runId = created.body.runId;
      await client.extract(runId, 0);
      const sessionId = await client.sessionId();
      const count = async (table: string) =>
        (await tx.unsafe(`select count(*)::int as n from ${table} where session_id = $1`, [sessionId]))[0]!.n as number;
      expect(await count("claims")).toBe(1);
      expect(await count("reference_entries")).toBe(2);

      const reply = await client.deleteRun(runId);
      expect(reply.status).toBe(204);
      expect(await count("runs")).toBe(0);
      expect(await count("claims")).toBe(0);
      expect(await count("reference_entries")).toBe(0);
      expect((await client.getRun(runId)).status).toBe(404);

      // The session survives, and its events (ids, counts, buckets) stay.
      expect((await client.listSources()).status).toBe(200);
      const logged = (await events(tx, sessionId)).map((e) => e.name);
      expect(logged).toContain("draft_submitted");
    });
  });

  it("never lets one session delete another session's check", async () => {
    await inTx(async (tx) => {
      const owner = newClient(tx, fakeLlm().llm);
      const runId = (await owner.createRun({ draft: DRAFT })).body.runId;
      const stranger = newClient(tx, fakeLlm().llm);
      await stranger.listSources();
      expect((await stranger.deleteRun(runId)).status).toBe(404);
      expect((await owner.getRun(runId)).status).toBe(200);
    });
  });

  it("answers 404 for an unknown or malformed id, and for a check that was already deleted", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      await client.listSources();
      expect((await client.deleteRun("00000000-0000-0000-0000-000000000000")).status).toBe(404);
      expect((await client.deleteRun("not-a-uuid")).status).toBe(404);
      const runId = (await client.createRun({ draft: DRAFT })).body.runId;
      expect((await client.deleteRun(runId)).status).toBe(204);
      expect((await client.deleteRun(runId)).status).toBe(404);
    });
  });
});

describe.skipIf(!enabled)("importing a draft", () => {
  const ID = "1zNfrhNd-YvYB6stWLrujUCABad9c6EQcCdJWlmdfMe8";
  const LINK = `https://docs.google.com/document/d/${ID}/edit?usp=sharing`;
  const plain = (body: string, status = 200, type = "text/plain; charset=utf-8") =>
    new Response(body, { status, headers: { "content-type": type } });
  /** A fetch that answers every request with the next response. It records what it was asked for. */
  const fetching = (...answers: Response[]) => {
    const asked: string[] = [];
    const impl = (async (input: URL | RequestInfo) => {
      asked.push(String(input));
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next;
    }) as typeof fetch;
    return { impl, asked };
  };
  const importLink = (client: ReturnType<typeof newClient>, url = LINK) =>
    client.send("POST", "/api/import", (c, r) => importDraft(c, r), { json: { url }, imports: true });
  const importFile = (client: ReturnType<typeof newClient>, bytes: Uint8Array, name = "draft.pdf") => {
    const form = new FormData();
    form.set("file", new File([bytes as unknown as BlobPart], name, { type: "application/pdf" }));
    return client.send("POST", "/api/import", (c, r) => importDraft(c, r), { form, imports: true });
  };

  it("reads a Google Doc and hands back clean text, without saving a draft or logging the link", async () => {
    await inTx(async (tx) => {
      const { impl, asked } = fetching(
        plain("﻿Spending rose by 4.2 percent (Contoh Statistics Office, 2024).[1]\r\n\r\n________________\r\n[1]A footnote.\r\n"),
      );
      const client = newClient(tx, fakeLlm().llm, undefined, undefined, impl);
      const runsBefore = (await tx<{ n: number }[]>`select count(*)::int as n from runs`)[0]!.n;
      const reply = await importLink(client);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        text: "Spending rose by 4.2 percent (Contoh Statistics Office, 2024).",
        source: "link",
        warnings: ["footnotes"],
        truncated: false,
        referenceCount: 0,
      });
      expect(asked).toEqual([`https://docs.google.com/document/d/${ID}/export?format=txt`]);

      // Nothing was saved: no run exists, and the event holds only a source and a size bucket.
      expect((await tx<{ n: number }[]>`select count(*)::int as n from runs`)[0]!.n).toBe(runsBefore);
      const [event] = await tx<{ props: Record<string, unknown> }[]>`
        select props from events where name = 'draft_imported' order by created_at desc limit 1`;
      expect(event!.props).toEqual({ source: "link", length_bucket: "short" });
      expect(JSON.stringify(event)).not.toContain(ID);
    });
  });

  it("reads a PDF draft, and refuses a scan and a file that is not a PDF", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const ok = await importFile(client, fixture("sample.pdf"));
      expect(ok.status).toBe(200);
      expect(ok.body.source).toBe("pdf");
      expect(ok.body.text.length).toBeGreaterThan(20);
      expect((await importFile(client, fixture("scanned.pdf"))).body.error.code).toBe("import_empty");
      const notPdf = await importFile(client, new TextEncoder().encode("plain text"), "draft.pdf");
      expect(notPdf.status).toBe(415);
      expect(notPdf.body.error.code).toBe("not_a_pdf");
    });
  });

  it("answers with a specific, safe reason for each thing that can go wrong", async () => {
    await inTx(async (tx) => {
      const cases: [Response | null, string, number, string?][] = [
        [plain("<html>sign in</html>", 404, "text/html"), "not_public", 422],
        [plain("<html>Sign in</html>", 200, "text/html"), "not_public", 422],
        [plain("", 429), "import_busy", 503],
        [plain("", 500), "import_failed", 502],
        [plain("   \r\n\r\n  "), "import_empty", 422],
      ];
      for (const [response, code, status] of cases) {
        const client = newClient(tx, fakeLlm().llm, undefined, undefined, fetching(response!).impl);
        const reply = await importLink(client);
        expect([reply.status, reply.body.error.code], code).toEqual([status, code]);
      }
      const client = newClient(tx, fakeLlm().llm, undefined, undefined, fetching().impl);
      expect((await importLink(client, "https://evil.example/document/d/" + ID)).body.error.code).toBe("bad_link");
      const published = "https://docs.google.com/document/d/e/2PACX-1vTEhc3TgbsBItovadXChRrcZ5VgxUtruvDC5wnEX5zxxqcFyg96q1YLRa9VdcrLuW44cM0jsbGvSSGb/pub";
      expect((await importLink(client, published)).body.error.code).toBe("published_link");
      expect((await client.send("POST", "/api/import", (c, r) => importDraft(c, r), { json: { nope: 1 }, imports: true })).status).toBe(400);
    });
  });

  it("limits how many imports one session can make, and answers 429", async () => {
    await inTx(async (tx) => {
      const limits: Limits = { ...DEFAULT_LIMITS, importsPerSession: 2 };
      const client = newClient(tx, fakeLlm().llm, undefined, limits, fetching(plain("one"), plain("two"), plain("three")).impl);
      expect((await importLink(client)).status).toBe(200);
      expect((await importLink(client)).status).toBe(200);
      const blocked = await importLink(client);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("rate_limited");
    });
  });
});

describe.skipIf(!enabled)("retention", () => {
  async function expiredRun(tx: postgres.TransactionSql): Promise<string> {
    const [owner] = await tx<{ id: string }[]>`
      insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
    const [run] = await tx<{ id: string }[]>`
      insert into runs (session_id, draft_text, input_type) values (${owner!.id}, 'an old draft', 'paste') returning id`;
    await tx`update runs set expires_at = now() - interval '1 day' where id = ${run!.id}`;
    return run!.id;
  }
  const exists = async (tx: postgres.TransactionSql, id: string) => (await tx`select id from runs where id = ${id}`).length === 1;

  it("deletes expired drafts when a session starts, and runs only once per window", async () => {
    await inTx(async (tx) => {
      await tx`delete from rate_limits where key = 'purge:expired'`; // open the window (rolled back with the test)
      const first = await expiredRun(tx);
      const visitor = newClient(tx, fakeLlm().llm);
      expect((await visitor.listSources()).status).toBe(200); // a new session: this request may purge
      expect(await exists(tx, first)).toBe(false);

      // The window is now closed: a second new session does not purge again.
      const second = await expiredRun(tx);
      expect((await newClient(tx, fakeLlm().llm).listSources()).status).toBe(200);
      expect(await exists(tx, second)).toBe(true);
    });
  });

  it("does not run for a returning session's ordinary requests", async () => {
    await inTx(async (tx) => {
      const visitor = newClient(tx, fakeLlm().llm);
      await visitor.listSources(); // starts the session (this one may purge)
      await tx`delete from rate_limits where key = 'purge:expired'`;
      const expired = await expiredRun(tx);
      await visitor.listSources(); // same session, seen a moment ago: not "active"
      expect(await exists(tx, expired)).toBe(true);
    });
  });
});

describe.skipIf(!enabled)("rate limits", () => {
  // The forwarded address is only believed behind a trusted proxy, so these tests say they are behind one.
  beforeAll(() => {
    process.env.TRUST_PROXY_HEADERS = "1";
  });
  afterAll(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });
  const tight: Limits = { ...DEFAULT_LIMITS, newSessionsPerAddress: 3, modelPerSession: 2, modelPerAddress: 50 };
  const from = (address: string) => ({ "x-forwarded-for": address });

  it("limits how many new sessions one address can start, and answers 429 with Retry-After", async () => {
    await inTx(async (tx) => {
      const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`; // a documentation address, unique per run
      for (let i = 0; i < tight.newSessionsPerAddress; i += 1) {
        const client = newClient(tx, fakeLlm().llm, undefined, tight);
        expect((await client.send("GET", "/api/sources", (c) => listSources(c), { headers: from(address) })).status).toBe(200);
      }
      const blocked = newClient(tx, fakeLlm().llm, undefined, tight);
      const reply = await blocked.send("GET", "/api/sources", (c) => listSources(c), { headers: from(address) });
      expect(reply.status).toBe(429);
      expect(reply.body.error.code).toBe("rate_limited");
      expect(Number(reply.retryAfter)).toBeGreaterThan(0);
      expect(reply.setCookie).toBeNull(); // a refused request does not start a session

      // A different address is unaffected.
      const other = newClient(tx, fakeLlm().llm, undefined, tight);
      expect((await other.send("GET", "/api/sources", (c) => listSources(c), { headers: from("198.51.100.7") })).status).toBe(200);
    });
  });

  it("does not limit a returning session's ordinary requests, only new sessions", async () => {
    await inTx(async (tx) => {
      const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const client = newClient(tx, fakeLlm().llm, undefined, tight);
      for (let i = 0; i < 10; i += 1) {
        const reply = await client.send("GET", "/api/sources", (c) => listSources(c), { headers: from(address) });
        expect(reply.status).toBe(200);
      }
    });
  });

  it("limits model-backed requests per session", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: singleClaim }).llm, undefined, tight);
      const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const created = await client.createRun(
        { draft: DRAFT },
        from(address),
      );
      const runId = created.body.runId;
      // modelPerSession is 2: the third model-backed request is refused.
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await client.send("POST", `/api/runs/${runId}/extract`, (c, r) => extractUnit(c, runId, r), { json: { unit: 0 }, model: true, headers: from(address) })).status);
      }
      expect(statuses.slice(0, 2).every((s) => s === 200)).toBe(true);
      expect(statuses[2]).toBe(429);
    });
  });
});

describe.skipIf(!enabled)("extracting claims", () => {
  it("extracts a single-unit draft, moves the run to checking, and does it only once", async () => {
    await inTx(async (tx) => {
      const { llm, calls } = fakeLlm({ extract: singleClaim });
      const client = newClient(tx, llm);
      const { body: created } = await client.createRun({ draft: DRAFT });

      const first = await client.extract(created.runId, 0);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ claimsAdded: 1, alreadyExtracted: false, status: "checking", unitsExtracted: 1, unitCount: 1, claimCount: 1 });

      const claims = await tx`select position, text, citation_text, status from claims where run_id = ${created.runId}`;
      expect(claims).toEqual([{ position: 1, text: "Inflation rose to 5 percent in 2023", citation_text: "(Smith, 2021)", status: "pending" }]);

      const logged = await events(tx, await client.sessionId());
      expect(logged.find((e) => e.name === "run_started")!.props).toEqual({ claim_count: 1 });

      const again = await client.extract(created.runId, 0);
      expect(again.body).toMatchObject({ alreadyExtracted: true, claimsAdded: 0, status: "checking" });
      expect(calls.extract).toBe(1);
      expect(await tx`select 1 from claims where run_id = ${created.runId}`).toHaveLength(1);
      expect((await events(tx, await client.sessionId())).filter((e) => e.name === "run_started")).toHaveLength(1);
    });
  });

  it("keeps the run extracting until the last unit of a long draft, with unique ordered positions", async () => {
    await inTx(async (tx) => {
      const draft = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} states a fact. (Smith, 2020) ` + "Some filler words continue here. ".repeat(9)).join("\n\n");
      const { llm } = fakeLlm({
        extract: (prompt) => {
          const first = /Paragraph \d+ states a fact\./.exec(prompt);
          // Cited, and in the reference list below, so the scan leaves them for the check and the run stays open.
          return { claims: first ? [{ text: first[0], citation: "(Smith, 2020)" }] : [] };
        },
      });
      const client = newClient(tx, llm);
      const { body: created } = await client.createRun({ draft, references: "Smith, J. (2020). A study of things. Journal of Things." });
      expect(created.unitCount).toBeGreaterThan(1);

      for (let unit = 0; unit < created.unitCount; unit += 1) {
        const reply = await client.extract(created.runId, unit);
        expect(reply.body.unitsExtracted).toBe(unit + 1);
        expect(reply.body.status).toBe(unit + 1 < created.unitCount ? "extracting" : "checking");
      }

      const run = await client.getRun(created.runId);
      expect(run.body.claims).toHaveLength(created.unitCount);
      const positions = run.body.claims.map((c: any) => c.position);
      expect(positions).toEqual([...positions].sort((a: number, b: number) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
      expect(run.body.run).toMatchObject({ status: "checking", unitsExtracted: created.unitCount });
    });
  });

  describe("the scan at the end of extraction", () => {
    // One paragraph per sentence: an uncited sentence that shares a paragraph with a citation takes that citation.
    const draftOf = (...sentences: string[]) => sentences.join("\n\n");
    const UNCITED = "Household spending rose sharply last year across the whole region.";
    const NOT_LISTED = "Food prices fell during the same year in the capital city (Brown, 2017).";
    const LISTED = "Rent was the largest expense for the lowest income group (Smith, 2020).";
    const REFS = "Smith, J. (2020). A study of household budgets. Journal of Things.";
    const claimsOf = (...entries: [string, string | null][]) => ({
      extract: () => ({ claims: entries.map(([text, citation]) => ({ text, citation })) }),
    });

    it("gives the claims that need no lookup their verdict at once, and leaves the cited ones for the check", async () => {
      await inTx(async (tx) => {
        const { llm, calls } = fakeLlm(claimsOf([UNCITED, null], [NOT_LISTED, "(Brown, 2017)"], [LISTED, "(Smith, 2020)"]));
        const client = newClient(tx, llm);
        const { body: created } = await client.createRun({ draft: draftOf(UNCITED, NOT_LISTED, LISTED), references: REFS });
        const reply = await client.extract(created.runId, 0);
        expect(reply.body.status).toBe("checking"); // every part has been read

        const run = (await client.getRun(created.runId)).body;
        const byText = (text: string) => run.claims.find((c: any) => c.text === text);
        expect(byText(UNCITED)).toMatchObject({ verdict: "no_citation_given", exitStage: 2, status: "done" });
        expect(byText(NOT_LISTED)).toMatchObject({ verdict: "reference_not_found", exitStage: 3, status: "done" });
        expect(byText(NOT_LISTED).reason).toBe('"Brown 2017" is not in your reference list.');
        expect(byText(LISTED)).toMatchObject({ verdict: null, status: "pending" }); // waits for the check
        expect(run.run.status).toBe("checking");
        expect(run.progress).toEqual({ checked: 2, total: 3 });
        expect(calls.judge).toBe(0); // no model call beyond the extraction
      });
    });

    it("gives an uncited sentence the citation at the end of its paragraph, and saves its section", async () => {
      await inTx(async (tx) => {
        const client = newClient(tx, fakeLlm(claimsOf([UNCITED, null], [LISTED, "(Smith, 2020)"])).llm);
        const draft = `2. Background\n\n${UNCITED} ${LISTED}`;
        const { body: created } = await client.createRun({ draft, references: REFS });
        await client.extract(created.runId, 0);
        const run = (await client.getRun(created.runId)).body;
        const uncited = run.claims.find((c: any) => c.text === UNCITED);
        expect(uncited).toMatchObject({ citation: "(Smith, 2020)", citationInherited: true, section: "2. Background", verdict: null });
        expect(run.claims.find((c: any) => c.text === LISTED)).toMatchObject({ citationInherited: false, section: "2. Background" });
      });
    });

    it("finishes the scan when a part is skipped, names it, and reads it again on request", async () => {
      await inTx(async (tx) => {
        let fail = true;
        const llm: Llm = {
          ...fakeLlm().llm,
          async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
            if (fail) throw new LlmOutputError("not valid JSON");
            return request.schema.parse({ claims: [{ text: UNCITED, citation: null }, { text: LISTED, citation: "(Smith, 2020)" }] });
          },
        };
        const client = newClient(tx, llm);
        const draft = `2. Background\n\n${UNCITED}\n\n${LISTED}`;
        const { body: created } = await client.createRun({ draft, references: REFS });

        // The model fails on the part, and on both halves: the request asks the browser to retry.
        expect((await client.extract(created.runId, 0)).status).toBe(503);
        // The browser gives up on it: the scan finishes with the part recorded as not read.
        const skipped = await client.extract(created.runId, 0, "skip");
        expect(skipped.body).toMatchObject({ failed: true, claimsAdded: 0, status: "completed" });
        let run = (await client.getRun(created.runId)).body;
        expect(run.failedParts).toEqual([{ unit: 0, section: "2. Background" }]);
        expect(run.claims).toEqual([]);

        // "Read again": the claims arrive, get their early verdicts, and the run opens again for the check.
        fail = false;
        const retried = await client.extract(created.runId, 0, "retry");
        expect(retried.body).toMatchObject({ failed: false, claimsAdded: 2 });
        run = (await client.getRun(created.runId)).body;
        expect(run.failedParts).toEqual([]);
        expect(run.run.status).toBe("checking");
        expect(run.claims.find((c: any) => c.text === UNCITED)).toMatchObject({ verdict: "no_citation_given" });
        expect(run.claims.find((c: any) => c.text === LISTED)).toMatchObject({ verdict: null });

        // A second "Read again" of a part that was read changes nothing.
        expect((await client.extract(created.runId, 0, "retry")).body).toMatchObject({ alreadyExtracted: true });
      });
    });

    it("logs one claim_checked event per early verdict, and no event holds the claim text", async () => {
      await inTx(async (tx) => {
        const before = (await tx<{ n: number }[]>`select count(*)::int as n from events where name = 'claim_checked'`)[0]!.n;
        const client = newClient(tx, fakeLlm(claimsOf([UNCITED, null], [NOT_LISTED, "(Brown, 2017)"], [LISTED, "(Smith, 2020)"])).llm);
        const { body: created } = await client.createRun({ draft: draftOf(UNCITED, NOT_LISTED, LISTED), references: REFS });
        await client.extract(created.runId, 0);
        const after = (await tx<{ n: number }[]>`select count(*)::int as n from events where name = 'claim_checked'`)[0]!.n;
        expect(after - before).toBe(2);
        const latest = await tx<{ props: Record<string, unknown> }[]>`
          select props from events where name = 'claim_checked' order by created_at desc, id desc limit 2`;
        for (const row of latest) {
          expect(Object.keys(row.props).sort()).toEqual(["exit_stage", "latency_ms", "retries", "verdict"]);
          expect(JSON.stringify(row.props)).not.toContain("Household");
        }
      });
    });

    it("closes the run at the scan when nothing is left to check (a draft with no citations at all)", async () => {
      await inTx(async (tx) => {
        const client = newClient(tx, fakeLlm(claimsOf([UNCITED, null])).llm);
        const { body: created } = await client.createRun({ draft: UNCITED });
        const reply = await client.extract(created.runId, 0);
        expect(reply.body.status).toBe("completed");
        const run = (await client.getRun(created.runId)).body;
        expect(run.counts).toEqual({ no_citation_given: 1 });
        expect(run.run.status).toBe("completed");
      });
    });

    it("says there is no reference list when none was added, for every cited claim", async () => {
      await inTx(async (tx) => {
        const client = newClient(tx, fakeLlm(claimsOf([LISTED, "(Smith, 2020)"])).llm);
        const { body: created } = await client.createRun({ draft: LISTED });
        await client.extract(created.runId, 0);
        const claim = (await client.getRun(created.runId)).body.claims[0];
        expect(claim.verdict).toBe("reference_not_found");
        expect(claim.reason).toContain("no reference list was added");
      });
    });

    it("scans a long draft in as many parts as it takes, and saves the early verdicts only once, at the end", async () => {
      await inTx(async (tx) => {
        const draft = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} states a fact. ` + "Some filler words continue here. ".repeat(9)).join("\n\n");
        const { llm } = fakeLlm({
          extract: (prompt) => {
            const first = /Paragraph \d+ states a fact\./.exec(prompt);
            return { claims: first ? [{ text: first[0], citation: null }] : [] };
          },
        });
        const client = newClient(tx, llm);
        const { body: created } = await client.createRun({ draft });
        for (let unit = 0; unit < created.unitCount - 1; unit += 1) {
          const reply = await client.extract(created.runId, unit);
          expect(reply.body.status).toBe("extracting");
          expect((await client.getRun(created.runId)).body.progress.checked).toBe(0); // nothing is decided before the last part is read
        }
        const last = await client.extract(created.runId, created.unitCount - 1);
        expect(last.body.status).toBe("completed"); // all uncited, so the scan finishes the run
        expect((await client.getRun(created.runId)).body.progress).toEqual({ checked: created.unitCount, total: created.unitCount });
      });
    });
  });

  it("completes a run with no claims straight away", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: () => ({ claims: [] }) }).llm);
      const { body: created } = await client.createRun({ draft: "Some thoughts with nothing checkable in them." });
      const reply = await client.extract(created.runId, 0);
      expect(reply.body).toMatchObject({ status: "completed", claimCount: 0 });
      const logged = await events(tx, await client.sessionId());
      expect(logged.map((e) => e.name)).toContain("run_completed");
      expect(logged.find((e) => e.name === "run_completed")!.props.verdict_counts).toEqual({});
    });
  });

  it("rejects a unit that does not exist, and a run that is not the caller's", async () => {
    await inTx(async (tx) => {
      const mine = newClient(tx, fakeLlm({ extract: singleClaim }).llm);
      const theirs = newClient(tx, fakeLlm({ extract: singleClaim }).llm);
      const { body: created } = await mine.createRun({ draft: DRAFT });
      await theirs.listSources();

      expect((await mine.extract(created.runId, 5)).body.error.code).toBe("unit_out_of_range");
      expect((await theirs.extract(created.runId, 0)).status).toBe(404);
      expect((await mine.extract("not-a-uuid", 0)).status).toBe(404);
      expect((await mine.send("POST", `/api/runs/${created.runId}/extract`, (c, r) => extractUnit(c, created.runId, r), { json: { unit: -1 } })).status).toBe(400);
    });
  });

  it("answers 503 with a retry hint when the model is unavailable, and records nothing until it works", async () => {
    await inTx(async (tx) => {
      let failing = true;
      const { llm } = fakeLlm({
        extract: () => {
          if (failing) throw new LlmUnavailableError("The Gemini API request failed (HTTP 503).", 503);
          return singleClaim();
        },
      });
      const client = newClient(tx, llm);
      const { body: created } = await client.createRun({ draft: DRAFT });

      const failed = await client.extract(created.runId, 0);
      expect(failed.status).toBe(503);
      expect(failed.body.error).toMatchObject({ code: "model_unavailable", retry: true });
      expect(failed.retryAfter).toBe("2");
      expect(await tx`select 1 from run_units where run_id = ${created.runId}`).toHaveLength(0);

      failing = false;
      expect((await client.extract(created.runId, 0)).status).toBe(200);
    });
  });
});

describe.skipIf(!enabled)("sources", () => {
  it("uploads a PDF, ingests it, lists it, and deletes it, logging source_uploaded once", async () => {
    await inTx(async (tx) => {
      const { llm } = fakeLlm();
      const client = newClient(tx, llm);

      const uploaded = await client.upload(pdfForm("sample.pdf"));
      expect(uploaded.status).toBe(201);
      expect(uploaded.body).toMatchObject({ status: "ingesting", pageCount: 3 });
      const id = uploaded.body.documentId;
      expect((await client.listSources()).body.sources[0]).toMatchObject({ id, filename: "paper.pdf", status: "ingesting", pageCount: 3 });

      const done = await client.ingest(id);
      expect(done.body).toEqual({ documentId: id, status: "ready", pagesIngested: 3, pageCount: 3, done: true });
      const again = await client.ingest(id);
      expect(again.body.done).toBe(true);

      const uploadedEvents = (await events(tx, await client.sessionId())).filter((e) => e.name === "source_uploaded");
      expect(uploadedEvents).toHaveLength(1);
      expect(uploadedEvents[0]!.props).toMatchObject({ page_bucket: "1_to_10" });
      expect(typeof uploadedEvents[0]!.props.ingest_ms).toBe("number");

      expect((await client.listSources()).body.sources[0].status).toBe("ready");
      const removed = await client.deleteSource(id);
      expect(removed.status).toBe(204);
      expect((await client.listSources()).body.sources).toEqual([]);
      expect((await client.deleteSource(id)).status).toBe(404);
    });
  });

  it("refuses the same PDF twice in one session, but allows it in another session", async () => {
    await inTx(async (tx) => {
      const first = newClient(tx, fakeLlm().llm);
      const up = await first.upload(pdfForm("sample.pdf", "report.pdf"));
      expect(up.status).toBe(201);

      const again = await first.upload(pdfForm("sample.pdf", "renamed-copy.pdf"));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("duplicate_source");
      expect(again.body.error.message).toContain("report.pdf");
      const list = await first.listSources();
      expect(list.body.sources).toHaveLength(1); // the duplicate left nothing behind

      const second = newClient(tx, fakeLlm().llm);
      expect((await second.upload(pdfForm("sample.pdf", "report.pdf"))).status).toBe(201);
    });
  });

  it("reports a scanned PDF as no_text at upload", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const uploaded = await client.upload(pdfForm("scanned.pdf", "scan.pdf"));
      expect(uploaded.body).toMatchObject({ status: "no_text", pageCount: 2 });
      const logged = (await events(tx, await client.sessionId())).filter((e) => e.name === "source_uploaded");
      expect(logged).toHaveLength(1);
      expect(logged[0]!.props.ingest_ms).toBe(0);
    });
  });

  it("rejects a file that is not a PDF, a missing file, and an oversized file", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);

      const text = new FormData();
      text.set("file", new File(["hello, this is plain text"], "notes.pdf"));
      expect((await client.upload(text)).body.error.code).toBe("not_a_pdf");

      expect((await client.upload(new FormData())).body.error.code).toBe("missing_file");

      const huge = new FormData();
      huge.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.pdf"));
      expect((await client.upload(huge)).status).toBe(413);

      expect((await client.listSources()).body.sources).toEqual([]);
    });
  });

  it("never lets one session ingest, list or delete another session's source", async () => {
    await inTx(async (tx) => {
      const mine = newClient(tx, fakeLlm().llm);
      const theirs = newClient(tx, fakeLlm().llm);
      const { body } = await theirs.upload(pdfForm("sample.pdf"));

      expect((await mine.ingest(body.documentId)).status).toBe(404);
      expect((await mine.deleteSource(body.documentId)).status).toBe(404);
      expect((await mine.listSources()).body.sources).toEqual([]);
      expect((await mine.ingest("not-a-uuid")).status).toBe(404);
      expect((await theirs.listSources()).body.sources).toHaveLength(1);
    });
  });
});

describe.skipIf(!enabled)("checking claims, end to end", () => {
  const DRAFT2 =
    "The dominant sequence transduction models are based on complex recurrent networks (Vaswani, 2017).\n\nReferences\n\n" +
    "Vaswani, A. (2017). Attention is all you need. Advances in Neural Information Processing Systems.";
  const found: ReferenceResolution = { status: "found", resolver: "crossref", doi: "10.1/x", title: "Attention Is All You Need", year: 2017, yearMismatch: false };
  const claim2 = () => ({ claims: [{ text: "The dominant sequence transduction models are based on complex recurrent networks (Vaswani, 2017).", citation: "(Vaswani, 2017)" }] });

  it("runs create, extract, upload, ingest and check, then shows a verified quote and closes the run", async () => {
    await inTx(async (tx) => {
      const { llm } = fakeLlm({
        extract: claim2,
        judge: () => ({
          verdict: "supported",
          quote: "The dominant sequence transduction models are based on complex recurrent networks",
          page: 1,
          chunk_id: "P1",
          reason: "The source states it.",
        }),
      });
      const client = newClient(tx, llm, async () => found);

      const { body: created } = await client.createRun({ draft: DRAFT2 });
      await client.extract(created.runId, 0);
      const { body: source } = await client.upload(pdfForm("sample.pdf"));
      await client.ingest(source.documentId);

      const before = await client.getRun(created.runId);
      expect(before.body.run.status).toBe("checking");
      expect(before.body.claims[0]).toMatchObject({ status: "pending", verdict: null });
      const claimId = before.body.claims[0].id;

      const checked = await client.check(claimId);
      expect(checked.status).toBe(200);
      expect(checked.body).toMatchObject({
        outcome: "done",
        runCompleted: true,
        verdict: { verdict: "supported", page: 1, exitStage: 7, quote: "The dominant sequence transduction models are based on complex recurrent networks" },
      });

      const after = await client.getRun(created.runId);
      expect(after.body.run.status).toBe("completed");
      expect(after.body.counts).toEqual({ supported: 1 });
      expect(after.body.progress).toEqual({ checked: 1, total: 1 });
      expect(after.body.fixList).toEqual([]);
      expect(after.body.references[0]).toMatchObject({ position: 1, resolution: "found", resolvedTitle: "Attention Is All You Need" });

      const logged = await events(tx, await client.sessionId());
      expect(logged.map((e) => e.name)).toEqual([
        "session_started", "draft_submitted", "references_added", "run_started", "source_uploaded", "claim_checked", "run_completed",
      ]);
      const everything = JSON.stringify(logged);
      for (const secret of ["dominant", "Vaswani", "Attention", "transduction"]) expect(everything).not.toContain(secret);
    });
  });

  it("says when the cited year is off, in the check reply and the reopened run, and keeps the verdict (UAT 23 Nov 2026)", async () => {
    await inTx(async (tx) => {
      const { llm } = fakeLlm({
        extract: claim2,
        judge: () => ({
          verdict: "supported",
          quote: "The dominant sequence transduction models are based on complex recurrent networks",
          page: 1,
          chunk_id: "P1",
          reason: "The source states it.",
        }),
      });
      const farYear: ReferenceResolution = { ...found, year: 2013, yearMismatch: true };
      const client = newClient(tx, llm, async () => farYear);

      const { body: created } = await client.createRun({ draft: DRAFT2 });
      await client.extract(created.runId, 0);
      const { body: source } = await client.upload(pdfForm("sample.pdf"));
      await client.ingest(source.documentId);
      const claimId = (await client.getRun(created.runId)).body.claims[0].id;

      const checked = await client.check(claimId);
      expect(checked.body.verdict).toMatchObject({ verdict: "supported", yearNotes: [{ position: 1, cited: 2017, published: 2013 }] });

      const reopened = await client.getRun(created.runId);
      expect(reopened.body.claims[0]).toMatchObject({ verdict: "supported", yearNotes: [{ position: 1, cited: 2017, published: 2013 }] });
      expect(reopened.body.fixList).toEqual([]);
    });
  });

  it("asks the browser to retry when a lookup fails, with the attempt number", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: claim2 }).llm, async () => ({ status: "error", reason: "Crossref returned HTTP 503" }));
      const { body: created } = await client.createRun({ draft: DRAFT2 });
      await client.extract(created.runId, 0);
      const claimId = (await client.getRun(created.runId)).body.claims[0].id;

      const reply = await client.check(claimId);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ outcome: "retry", reason: "Crossref returned HTTP 503", attempt: 1 });
    });
  });

  it("ends a claim that cites a reference not in the list as Reference not found, with the reason", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: () => ({ claims: [{ text: "Rates rose sharply in 2019 overall", citation: "(Jones, 2019)" }] }) }).llm, async () => found);
      const { body: created } = await client.createRun({ draft: "Rates rose sharply in 2019 overall (Jones, 2019).\n\nReferences\n\nSmith, J. (2021). A title here. Journal." });
      await client.extract(created.runId, 0);
      const claimId = (await client.getRun(created.runId)).body.claims[0].id;
      const reply = await client.check(claimId);
      expect(reply.body.verdict).toMatchObject({ verdict: "reference_not_found", exitStage: 3 });
      expect(reply.body.verdict.reason).toMatch(/not in your reference list/);
    });
  });

  it("returns 404 for an unknown claim and for another session's claim", async () => {
    await inTx(async (tx) => {
      const mine = newClient(tx, fakeLlm({ extract: claim2 }).llm, async () => found);
      const theirs = newClient(tx, fakeLlm().llm);
      const { body: created } = await mine.createRun({ draft: DRAFT2 });
      await mine.extract(created.runId, 0);
      const claimId = (await mine.getRun(created.runId)).body.claims[0].id;
      await theirs.listSources();

      expect((await theirs.check(claimId)).status).toBe(404);
      expect((await mine.check("0b9d8a52-7f0e-4a6a-9d0c-6f1f7a3c2b11")).status).toBe(404);
      expect((await mine.check("not-a-uuid")).status).toBe(404);
      expect((await theirs.getRun(created.runId)).status).toBe(404);
    });
  });
});

describe.skipIf(!enabled)("the ranked fix list", () => {
  it("lists claims that need attention most serious first, and leaves out Supported ones", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm({ extract: singleClaim }).llm);
      const { body: created } = await client.createRun({ draft: DRAFT });
      const sessionId = await client.sessionId();

      const verdicts: [number, string][] = [[1, "partial"], [2, "supported"], [3, "contradicted"], [4, "cant_check"], [5, "contradicted"]];
      const ids = new Map<number, string>();
      for (const [position, verdict] of verdicts) {
        const [row] = await tx<{ id: string }[]>`
          insert into claims (run_id, session_id, position, text, status)
          values (${created.runId}, ${sessionId}, ${position}, ${`Claim ${position}`}, 'done') returning id`;
        ids.set(position, row!.id);
        await tx`
          insert into verdicts (claim_id, session_id, verdict, quote, page, reason, exit_stage)
          values (${row!.id}, ${sessionId}, ${verdict}, ${verdict === "cant_check" ? null : "A quote long enough to count"}, ${verdict === "cant_check" ? null : 2}, 'r', ${verdict === "cant_check" ? 4 : 7})`;
      }

      const run = await client.getRun(created.runId);
      expect(run.body.fixList).toEqual([ids.get(3), ids.get(5), ids.get(1), ids.get(4)]);
      expect(run.body.counts).toEqual({ partial: 1, supported: 1, contradicted: 2, cant_check: 1 });
      expect(run.body.claims.map((c: any) => c.position)).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

describe.skipIf(!enabled)("client events", () => {
  it("accepts an allowed client event and stores only its fields", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const reply = await client.event({ name: "evidence_opened", props: { verdict: "supported" } });
      expect(reply.status).toBe(204);
      const logged = (await events(tx, await client.sessionId())).filter((e) => e.name === "evidence_opened");
      expect(logged).toHaveLength(1);
      expect(logged[0]!.props).toEqual({ verdict: "supported" });
    });
  });

  it("refuses events the server logs itself, unknown events, extra keys, and free text", async () => {
    await inTx(async (tx) => {
      const client = newClient(tx, fakeLlm().llm);
      const bad: unknown[] = [
        { name: "claim_checked", props: { verdict: "supported", exit_stage: 7, latency_ms: 1, retries: 0 } },
        { name: "run_completed", props: { duration_ms: 1, verdict_counts: {} } },
        { name: "made_up_event", props: {} },
        { name: "verdict_flagged_wrong", props: { verdict: "partial", quote: "the student's private quote" } },
        { name: "would_pay_answered", props: { answer: "yes", price_bucket: "a long sentence of free text" } },
        { name: "evidence_opened", props: { verdict: "not a verdict" } },
        { props: {} },
      ];
      for (const body of bad) {
        const reply = await client.event(body);
        expect(reply.status, JSON.stringify(body)).toBe(400);
      }
      const stored = (await events(tx, await client.sessionId())).map((e) => e.name);
      expect(stored).toEqual(["session_started"]);
      expect((await client.send("POST", "/api/events", (c, r) => postEvent(c, r), { rawBody: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    });
  });
});

describe.skipIf(!enabled)("Find a source", () => {
  const UNCITED = "Casual employment in small firms grew sharply between 2015 and 2020.";
  const CITED = "Rent was the largest expense for the lowest income group (Smith, 2020).";
  const REFS = "Smith, J. (2020). A study of household budgets. Journal of Things.";
  const extract = () => ({ claims: [{ text: UNCITED, citation: null }, { text: CITED, citation: "(Smith, 2020)" }] });
  const FOUND: DiscoverResult = {
    exit: "found",
    considered: 6,
    dropped: { notInAbstract: 0, notRelevant: 1, badPick: 0 },
    sources: [
      {
        openalexId: "https://openalex.org/W1",
        doi: "https://doi.org/10.1/w1",
        title: "Flexible work in small firms",
        year: 2021,
        authors: ["Kim Lee", "Mei Tan"],
        venue: "Journal of Work",
        openAccessPdf: "https://repo.example/w1.pdf",
        sentence: "Casual employment grew 18% between 2015 and 2020.",
        relevance: "direct",
      },
    ],
  };

  async function setup(tx: postgres.TransactionSql, discover: ApiDeps["discover"]) {
    const client = newClient(tx, fakeLlm({ extract }).llm, undefined, undefined, undefined, discover);
    const { body: created } = await client.createRun({ draft: `${UNCITED}\n\n${CITED}`, references: REFS });
    await client.extract(created.runId, 0);
    const run = (await client.getRun(created.runId)).body;
    const id = (text: string) => run.claims.find((c: any) => c.text === text).id as string;
    return { client, runId: created.runId as string, uncited: id(UNCITED), cited: id(CITED) };
  }

  it("finds papers once, saves them for the run, and logs only counts", async () => {
    await inTx(async (tx) => {
      const calls: string[] = [];
      const { client, runId, uncited } = await setup(tx, async (text) => (calls.push(text), FOUND));

      const first = await client.findSources(uncited);
      expect(first.status).toBe(200);
      expect(first.body.sources).toEqual([{ rank: 1, ...FOUND.sources[0] }]);
      expect(calls).toEqual([UNCITED]);

      // A second press returns what was saved, with no new search.
      expect((await client.findSources(uncited)).body.sources).toHaveLength(1);
      expect(calls).toHaveLength(1);

      const claim = (await client.getRun(runId)).body.claims.find((c: any) => c.id === uncited);
      expect(claim).toMatchObject({ sourcesSearched: true, sources: [{ rank: 1, title: "Flexible work in small firms", authors: ["Kim Lee", "Mei Tan"] }] });

      const logged = (await events(tx, await client.sessionId())).filter((e) => e.name === "sources_suggested");
      expect(logged).toHaveLength(1);
      expect(logged[0]!.props).toEqual({ count: 1, latency_ms: expect.any(Number), outcome: "found" });
      expect(JSON.stringify(logged)).not.toMatch(/Flexible|Casual|small firms/);
    });
  });

  it("remembers that nothing was found, so a reload says so and a repeat makes no search", async () => {
    await inTx(async (tx) => {
      let calls = 0;
      const nothing: DiscoverResult = { exit: "nothing_relevant", sources: [], considered: 4, dropped: { notInAbstract: 0, notRelevant: 4, badPick: 0 } };
      const { client, runId, uncited } = await setup(tx, async () => (calls += 1, nothing));
      expect((await client.findSources(uncited)).body.sources).toEqual([]);
      await client.findSources(uncited);
      expect(calls).toBe(1);
      expect((await client.getRun(runId)).body.claims.find((c: any) => c.id === uncited)).toMatchObject({ sourcesSearched: true, sources: [] });
    });
  });

  it("asks the browser to retry when the search fails, and saves nothing", async () => {
    await inTx(async (tx) => {
      const failed: DiscoverResult = { exit: "search_failed", sources: [], considered: 0, dropped: { notInAbstract: 0, notRelevant: 0, badPick: 0 } };
      const { client, runId, uncited } = await setup(tx, async () => failed);
      const reply = await client.findSources(uncited);
      expect(reply.status).toBe(503);
      expect(reply.body.error).toMatchObject({ code: "search_busy", retry: true });
      expect((await client.getRun(runId)).body.claims.find((c: any) => c.id === uncited)).toMatchObject({ sourcesSearched: false, sources: [] });
    });
  });

  it("refuses a cited claim, and another session's claim", async () => {
    await inTx(async (tx) => {
      const { cited, uncited } = await setup(tx, async () => FOUND);
      const { client } = await setup(tx, async () => FOUND);
      expect((await client.findSources(cited)).status).toBe(404); // another session's
      const own = await setup(tx, async () => FOUND);
      expect((await own.client.findSources(own.cited)).body.error.code).toBe("not_uncited");
      expect(uncited).not.toBe(own.uncited);
    });
  });
});

describe.skipIf(!enabled)("Check against a found paper", () => {
  const UNCITED = "Casual employment in small firms grew sharply between 2015 and 2020.";
  const OTHER = "Hourly workers in small firms change shifts more often than salaried staff.";
  const extract = () => ({ claims: [{ text: UNCITED, citation: null }, { text: OTHER, citation: null }] });
  const paper = (rank: number, pdf: string | null) => ({
    openalexId: `https://openalex.org/W${rank}`,
    doi: `https://doi.org/10.1/w${rank}`,
    title: "Flexible work in small firms",
    year: 2021,
    authors: ["Kim Lee", "Mei Tan"],
    venue: "Journal of Work",
    openAccessPdf: pdf,
    sentence: "Casual employment grew 18% between 2015 and 2020.",
    relevance: "direct" as const,
  });
  const FOUND: DiscoverResult = {
    exit: "found",
    considered: 4,
    dropped: { notInAbstract: 0, notRelevant: 0, badPick: 0 },
    sources: [paper(1, "https://repo.example/w1.pdf"), paper(2, null)],
  };

  async function setup(tx: postgres.TransactionSql, fetchPdfImpl: ApiDeps["fetchPdf"] = async () => fixture("sample.pdf")) {
    const client = newClient(tx, fakeLlm({ extract }).llm, undefined, undefined, undefined, async () => FOUND, fetchPdfImpl);
    const { body: created } = await client.createRun({ draft: `${UNCITED}\n\n${OTHER}` });
    await client.extract(created.runId, 0);
    const run = (await client.getRun(created.runId)).body;
    const id = (text: string) => run.claims.find((c: any) => c.text === text).id as string;
    await client.findSources(id(UNCITED));
    await client.findSources(id(OTHER));
    return { client, runId: created.runId as string, claimId: id(UNCITED), otherId: id(OTHER) };
  }

  it("fetches the open-access PDF, links it to the claim as a found citation, and reopens the claim for the check", async () => {
    await inTx(async (tx) => {
      const { client, runId, claimId } = await setup(tx);
      expect((await client.getRun(runId)).body.run.status).toBe("completed"); // nothing was cited, so the scan closed it

      const reply = await client.attach(claimId, 1);
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ claimId, status: "ingesting", pageCount: expect.any(Number) });

      const run = (await client.getRun(runId)).body;
      expect(run.run.status).toBe("checking");
      expect(run.claims.find((c: any) => c.id === claimId)).toMatchObject({
        citation: "(Lee & Tan, 2021)",
        citationSource: "found",
        verdict: null,
        status: "pending",
      });
      const [entry] = await tx<{ raw_text: string; document_id: string }[]>`
        select raw_text, document_id from reference_entries where run_id = ${runId}`;
      expect(entry).toEqual({
        raw_text: "Lee, K., & Tan, M. (2021). Flexible work in small firms. Journal of Work. https://doi.org/10.1/w1",
        document_id: reply.body.documentId,
      });
      const logged = (await events(tx, await client.sessionId())).filter((e) => e.name === "source_attached");
      expect(logged.map((e) => e.props)).toEqual([{ how: "open_access" }]);
    });
  });

  it("takes an uploaded PDF for a paper with no free copy, and reuses the same PDF for a second claim", async () => {
    await inTx(async (tx) => {
      const { client, claimId, otherId } = await setup(tx);
      const noFree = await client.attach(claimId, 2);
      expect(noFree.body.error.code).toBe("no_open_access");

      const uploaded = await client.attach(claimId, 2, pdfForm("sample.pdf"));
      expect(uploaded.status).toBe(201);
      const again = await client.attach(otherId, 1); // the fake fetch returns the same bytes
      expect(again.body.documentId).toBe(uploaded.body.documentId);
      const [count] = await tx<{ n: number }[]>`select count(*)::int as n from documents where session_id = ${await client.sessionId()}`;
      expect(count?.n).toBe(1);
    });
  });

  it("says when the paper could not be downloaded, and changes nothing", async () => {
    await inTx(async (tx) => {
      const { client, runId, claimId } = await setup(tx, async () => {
        throw new PdfFetchError("not_pdf");
      });
      const reply = await client.attach(claimId, 1);
      expect(reply.status).toBe(422);
      expect(reply.body.error.code).toBe("fetch_failed");
      const claim = (await client.getRun(runId)).body.claims.find((c: any) => c.id === claimId);
      expect(claim).toMatchObject({ verdict: "no_citation_given", citationSource: "draft", citation: null });
    });
  });

  it("refuses a second attach to the same claim, an unknown rank, and another session's claim", async () => {
    await inTx(async (tx) => {
      const { client, claimId } = await setup(tx);
      expect((await client.attach(claimId, 1)).status).toBe(201);
      expect((await client.attach(claimId, 1)).body.error.code).toBe("already_cited");
      expect((await client.attach(claimId, 7)).status).toBe(404);
      const stranger = await setup(tx);
      expect((await stranger.client.attach(claimId, 1)).status).toBe(404);
    });
  });
});
