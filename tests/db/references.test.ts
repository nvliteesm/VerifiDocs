// Source discovery for the reference list, against the Neon `dev` branch with real Request objects and fake lookups.
// Skipped unless NEON_BRANCH=dev. Each test runs in a transaction that is rolled back.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { handleWith, type ApiContext, type ApiDeps } from "../../src/lib/api/handler";
import { createRun } from "../../src/lib/api/runs";
import { confirmEntryHandler, discoverEntryHandler, linkEntryHandler, listReferencesHandler, retrieveEntryHandler } from "../../src/lib/api/references";
import { PdfFetchError } from "../../src/lib/pipeline/fetch-pdf";
import type { ReferenceResolution } from "../../src/lib/pipeline/resolve-reference";

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

const pdf = () => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "sample.pdf")));

const ENTRIES = [
  "Winarno, Heru, dan Rully Pujantara. 2015. “Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen”. Jurnal Scientific PINISI, Vol.1, No.1, hlm. 1-6.",
  "Hermanto, Dony. 2014. Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk. Skripsi. Surakarta: UNS.",
  "Badan Standardisasi Nasional. 1989. SNI 03-0349-1989 Bata Beton untuk Pasangan Dinding.",
].join("\n\n");
const DRAFT = "Batako berfungsi sebagai penahan gaya horizontal pada dinding bangunan (Winarno dan Pujantara, 2015).";

interface Options {
  resolve?: (raw: string) => Promise<ReferenceResolution>;
  fetch?: typeof fetch;
  fetchPdf?: (link: string) => Promise<Uint8Array>;
}

function client(tx: postgres.TransactionSql, options: Options = {}) {
  const deps: ApiDeps = {
    sql: tx,
    llm: { generateJson: async () => { throw new Error("not used"); }, embed: async () => { throw new Error("not used"); } },
    resolve: options.resolve ?? (async () => ({ status: "not_found" })),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.fetchPdf ? { fetchPdf: options.fetchPdf } : {}),
  };
  let cookie: string | null = null;
  const send = async (fn: (context: ApiContext, request: Request) => Promise<Response>, body?: unknown, discovery = false) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const request = new Request("http://localhost:3000/x", { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const response = await handleWith(deps, request, (context) => fn(context, request), discovery ? { discovery: true } : {});
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  };
  return {
    send,
    async newRun() {
      const reply = await send((c, r) => createRun(c, r), { draft: DRAFT, references: ENTRIES });
      return reply.body.runId as string;
    },
    list: (runId: string) => send((c) => listReferencesHandler(c, runId)),
    discover: (runId: string, id: string) => send((c) => discoverEntryHandler(c, runId, id), {}, true),
    retrieve: (runId: string, id: string) => send((c) => retrieveEntryHandler(c, runId, id), {}, true),
    confirm: (runId: string, id: string, accept: boolean) => send((c, r) => confirmEntryHandler(c, runId, id, r), { accept }),
    link: (runId: string, id: string, documentId: string) => send((c, r) => linkEntryHandler(c, runId, id, r), { documentId }),
  };
}

/** A fake OpenAlex that answers every works query with these results. */
const openAlex = (results: unknown[]): typeof fetch => (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;
const FOUND: ReferenceResolution = { status: "found", resolver: "openalex", doi: "10.1/abc", title: "Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen", year: 2015, yearMismatch: false };
const WITH_PDF = openAlex([{ doi: "10.1/abc", title: "x", best_oa_location: { pdf_url: "https://example.org/a.pdf" }, primary_location: { source: { display_name: "Jurnal Scientific PINISI" } } }]);

describe.skipIf(!enabled)("source discovery for the reference list", () => {
  it("lists every entry as pending, with its real title and no PDF link in the view", async () => {
    await inTx(async (tx) => {
      const api = client(tx);
      const runId = await api.newRun();
      const { status, body } = await api.list(runId);
      expect(status).toBe(200);
      expect(body.references).toHaveLength(3);
      expect(body.references.every((r: any) => r.sourceState === "pending")).toBe(true);
      expect(body.references[0].title).toBe("Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen");
      expect(JSON.stringify(body)).not.toContain("pdfUrl");
    });
  });

  it("matches an entry the resolver accepts, saves it once, and does not look it up again", async () => {
    await inTx(async (tx) => {
      let lookups = 0;
      const api = client(tx, { resolve: async () => (lookups++, FOUND), fetch: WITH_PDF });
      const runId = await api.newRun();
      const first = (await api.list(runId)).body.references[0];
      const reply = await api.discover(runId, first.id);
      expect(reply.body.reference).toMatchObject({ sourceState: "matched", refType: "journal", candidate: { doi: "10.1/abc", hasPdf: true } });
      await api.discover(runId, first.id);
      expect(lookups).toBe(1);
    });
  });

  it("retrieves a matched PDF, attaches it to the entry, and reuses the same PDF for a second entry", async () => {
    await inTx(async (tx) => {
      const api = client(tx, { resolve: async () => FOUND, fetch: WITH_PDF, fetchPdf: async () => pdf() });
      const runId = await api.newRun();
      const [a, b] = (await api.list(runId)).body.references;
      await api.discover(runId, a.id);
      await api.discover(runId, b.id);
      const one = await api.retrieve(runId, a.id);
      expect(one.status).toBe(201);
      expect(one.body.reference).toMatchObject({ sourceState: "retrieved" });
      expect(one.body.document.documentId).toBeTruthy();
      const two = await api.retrieve(runId, b.id);
      expect(two.body.document.documentId).toBe(one.body.document.documentId);
      const counted = await tx<{ n: number }[]>`select count(*)::int as n from documents where session_id = (select session_id from reference_entries where id = ${a.id})`;
      expect(counted[0]!.n).toBe(1);
    });
  });

  it("keeps the match but asks for an upload when the PDF cannot be fetched, and never calls it fake", async () => {
    await inTx(async (tx) => {
      const api = client(tx, { resolve: async () => FOUND, fetch: WITH_PDF, fetchPdf: async () => { throw new PdfFetchError("not_pdf"); } });
      const runId = await api.newRun();
      const a = (await api.list(runId)).body.references[0];
      await api.discover(runId, a.id);
      const reply = await api.retrieve(runId, a.id);
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ reference: { sourceState: "matched_no_file" }, document: null });
    });
  });

  it("offers a look-alike as a possible match, attaches nothing until the student says yes, and a no is final", async () => {
    await inTx(async (tx) => {
      const lookalike = openAlex([{ doi: "10.2/zzz", title: "Pengaruh komposisi bahan pengisi styrofoam pada batako", publication_year: 2016, authorships: [{ author: { display_name: "Heru Winarno" } }], best_oa_location: { pdf_url: "https://example.org/b.pdf" } }]);
      const api = client(tx, { resolve: async () => ({ status: "not_found" }), fetch: lookalike, fetchPdf: async () => pdf() });
      const runId = await api.newRun();
      const a = (await api.list(runId)).body.references[0];
      const found = await api.discover(runId, a.id);
      expect(found.body.reference).toMatchObject({ sourceState: "possible", candidate: { year: 2016, hasPdf: true }, documentId: null });
      expect((await api.retrieve(runId, a.id)).status).toBe(409); // not matched: nothing is attached on a guess
      expect((await api.confirm(runId, a.id, true)).body.reference.sourceState).toBe("matched");
      expect((await api.retrieve(runId, a.id)).body.reference.sourceState).toBe("retrieved");

      const second = (await api.list(runId)).body.references[1];
      await tx`update reference_entries set source_state = 'possible', candidate = ${tx.json({ title: "Something", year: 2014, doi: null, venue: null, pdfUrl: null })} where id = ${second.id}`;
      const no = await api.confirm(runId, second.id, false);
      expect(no.body.reference).toMatchObject({ sourceState: "not_retrieved", candidate: null });
    });
  });

  it("says not retrieved for a thesis nothing indexes, and for a standard without looking it up", async () => {
    await inTx(async (tx) => {
      let asked = 0;
      const counting = (async () => (asked++, new Response(JSON.stringify({ results: [] }), { status: 200 }))) as unknown as typeof fetch;
      const api = client(tx, { resolve: async () => ({ status: "not_found" }), fetch: counting });
      const runId = await api.newRun();
      const [, thesis, standard] = (await api.list(runId)).body.references;
      expect((await api.discover(runId, thesis.id)).body.reference).toMatchObject({ sourceState: "not_retrieved", refType: "thesis" });
      const before = asked;
      expect((await api.discover(runId, standard.id)).body.reference).toMatchObject({ sourceState: "not_retrieved", refType: "standard" });
      expect(asked).toBe(before);
    });
  });

  it("saves nothing when a lookup fails, so the browser can try again", async () => {
    await inTx(async (tx) => {
      const api = client(tx, { resolve: async () => ({ status: "error", reason: "Crossref returned HTTP 429" }) });
      const runId = await api.newRun();
      const a = (await api.list(runId)).body.references[0];
      const reply = await api.discover(runId, a.id);
      expect(reply.status).toBe(503);
      expect((await api.list(runId)).body.references[0].sourceState).toBe("pending");
    });
  });

  it("links the student's own upload to the entry", async () => {
    await inTx(async (tx) => {
      const api = client(tx);
      const runId = await api.newRun();
      const a = (await api.list(runId)).body.references[0];
      const [session] = await tx<{ session_id: string }[]>`select session_id from reference_entries where id = ${a.id}`;
      const [doc] = await tx<{ id: string }[]>`insert into documents (session_id, filename, status) values (${session!.session_id}, 'mine.pdf', 'ready') returning id`;
      const reply = await api.link(runId, a.id, doc!.id);
      expect(reply.body.reference).toMatchObject({ sourceState: "uploaded", documentId: doc!.id });
    });
  });

  it("keeps one student's references out of another's reach", async () => {
    await inTx(async (tx) => {
      const alice = client(tx);
      const runId = await alice.newRun();
      const a = (await alice.list(runId)).body.references[0];
      const bob = client(tx);
      await bob.newRun();
      expect((await bob.list(runId)).body.references).toEqual([]);
      expect((await bob.discover(runId, a.id)).status).toBe(404);
    });
  });
});
