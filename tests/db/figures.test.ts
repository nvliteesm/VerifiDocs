// "Check my numbers" handler against the Neon `dev` branch, with real Request objects and a fake model.
// Skipped unless NEON_BRANCH=dev. Each test runs in a transaction that is rolled back.
/* eslint-disable @typescript-eslint/no-explicit-any */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { contradictionsHandler, readFiguresHandler, savedFiguresHandler } from "../../src/lib/api/figures";
import { handleWith, type ApiContext, type ApiDeps } from "../../src/lib/api/handler";
import { createRun } from "../../src/lib/api/runs";
import type { GenerateJsonRequest, Llm } from "../../src/lib/llm/adapter";

const url = process.env.DATABASE_URL_UNPOOLED;
const enabled = Boolean(url) && process.env.NEON_BRANCH === "dev";

class Rollback extends Error {}
const sql = enabled ? postgres(url as string, { max: 1, onnotice: () => {} }) : null;
afterAll(async () => {
  await sql?.end();
});

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

const DRAFT = "## Hasil\n\nDaya serap air batako daun ketapang kering sebesar 1,893%.\n\n## Kesimpulan\n\nDaya serap air batako daun ketapang kering sebesar 1,839%.";

function client(tx: postgres.TransactionSql, answer: unknown, calls: { n: number } = { n: 0 }) {
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      calls.n += 1;
      return request.schema.parse(typeof answer === "function" ? (answer as (prompt: string) => unknown)(request.prompt) : answer);
    },
    async embed() {
      throw new Error("not used");
    },
  };
  const deps: ApiDeps = { sql: tx, llm };
  let cookie: string | null = null;
  const send = async (fn: (context: ApiContext, request: Request) => Promise<Response>, body: unknown, model = false) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const request = new Request("http://localhost:3000/x", { method: "POST", headers, body: JSON.stringify(body) });
    const response = await handleWith(deps, request, (context) => fn(context, request), model ? { model: true } : {});
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  };
  return {
    newRun: async () => (await send((c, r) => createRun(c, r), { draft: DRAFT })).body.runId as string,
    figures: (runId: string, unit: number, refresh = false) => send((c, r) => readFiguresHandler(c, runId, r), { unit, refresh }, true),
    saved: (runId: string) => send((c) => savedFiguresHandler(c, runId), {}),
    contradictions: (runId: string, refresh = false) => send((c, r) => contradictionsHandler(c, runId, r), { refresh }, true),
  };
}

const answer = {
  figures: [
    { label: "Daya serap air batako daun ketapang kering", value: "1,893", unit: "%", sentence: "Daya serap air batako daun ketapang kering sebesar 1,893%." },
    { label: "Made up", value: "7", unit: null, sentence: "This sentence is nowhere in the draft, 7." },
  ],
};

describe.skipIf(!enabled)("check my numbers", () => {
  it("returns the figures a part reports with the section each sits under, drops invented ones, and changes no claim", async () => {
    await inTx(async (tx) => {
      const api = client(tx, answer);
      const runId = await api.newRun();
      const before = await tx<{ n: number }[]>`select count(*)::int as n from claims where run_id = ${runId}`;
      const reply = await api.figures(runId, 0);
      expect(reply.status).toBe(200);
      expect(reply.body.figures).toEqual([
        { label: "Daya serap air batako daun ketapang kering", value: "1,893", unit: "%", sentence: "Daya serap air batako daun ketapang kering sebesar 1,893%.", section: "Hasil" },
      ]);
      expect(reply.body.dropped).toBe(1);
      const after = await tx<{ n: number }[]>`select count(*)::int as n from claims where run_id = ${runId}`;
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  });

  it("refuses a part that does not exist, and a run that belongs to someone else", async () => {
    await inTx(async (tx) => {
      const alice = client(tx, answer);
      const runId = await alice.newRun();
      expect((await alice.figures(runId, 99)).status).toBe(400);
      const bob = client(tx, answer);
      await bob.newRun();
      expect((await bob.figures(runId, 0)).status).toBe(404);
    });
  });

  it("keeps what it read: a repeat asks no model, a reload gets it back, refresh reads again", async () => {
    await inTx(async (tx) => {
      const calls = { n: 0 };
      const api = client(tx, answer, calls);
      const runId = await api.newRun();
      await api.figures(runId, 0);
      expect(calls.n).toBe(1);
      const again = await api.figures(runId, 0);
      expect(again.body.saved).toBe(true);
      expect(again.body.figures).toHaveLength(1);
      expect(calls.n).toBe(1);
      const reload = await api.saved(runId);
      expect(reload.body.units).toHaveLength(1);
      expect(reload.body.units[0].figures[0].section).toBe("Hasil");
      expect(reload.body.contradictions).toBeNull();
      await api.figures(runId, 0, true);
      expect(calls.n).toBe(2);
    });
  });

  it("compares the saved findings, keeps the pairs, and forgets them when a part is read again", async () => {
    await inTx(async (tx) => {
      const findings = { figures: [], statements: [{ sentence: "Batako daun ketapang kering menyerap air paling sedikit." }, { sentence: "Batako daun ketapang kering menyerap air paling banyak." }] };
      const calls = { n: 0 };
      const api = client(tx, (prompt: string) => (prompt.includes("<sentences>") ? { pairs: [{ a: 0, b: 1, note: "paling sedikit / paling banyak" }] } : findings), calls);
      const runId = await api.newRun();
      expect((await api.contradictions(runId)).body.pairs).toEqual([]);
      await api.figures(runId, 0);
      const found = await api.contradictions(runId, true);
      // Both findings were read from one part and one section, so they are one passage, not two places.
      expect(found.status).toBe(200);
      expect(found.body.pairs).toEqual([]);
      expect((await api.saved(runId)).body.contradictions).toEqual([]);
      await api.figures(runId, 0, true);
      expect((await api.saved(runId)).body.contradictions).toBeNull();
    });
  });

  it("does not hand one session's saved figures to another", async () => {
    await inTx(async (tx) => {
      const alice = client(tx, answer);
      const runId = await alice.newRun();
      await alice.figures(runId, 0);
      const bob = client(tx, answer);
      await bob.newRun();
      expect((await bob.saved(runId)).status).toBe(404);
      expect((await bob.contradictions(runId)).status).toBe(404);
    });
  });
});
