// Stage 5 against a fixture on the Neon `dev` branch. Skipped unless NEON_BRANCH=dev.
// Each test runs in a transaction that is rolled back. Embeddings come from a fake client, so no
// Gemini call is made.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, LlmUnavailableError, type EmbedTask, type Llm } from "../../src/lib/llm/adapter";
import {
  MAX_DOCUMENTS_PER_SESSION,
  abandonDocument,
  createDocumentFromPdf,
  ingestNextBatch,
} from "../../src/lib/pipeline/ingest";
import { retrieveTopChunks } from "../../src/lib/rag/retrieve";

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

async function newSession(tx: postgres.TransactionSql): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  return row!.id;
}

const pdf = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

const probe = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

/** A fake embedding client. Every vector is one-hot on axis 0, so no network call is made. */
function fakeLlm(options: { failOnCall?: number; onEmbed?: () => Promise<void> } = {}) {
  const calls: { count: number; task: EmbedTask }[] = [];
  const llm: Llm = {
    async generateJson() {
      throw new Error("not used");
    },
    async embed(texts, task) {
      calls.push({ count: texts.length, task });
      if (options.failOnCall === calls.length) {
        throw new LlmUnavailableError("The Gemini API request failed (HTTP 503).", 503);
      }
      await options.onEmbed?.();
      return texts.map(() => [...probe]);
    },
  };
  return { llm, calls };
}

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("stage 5 ingest (dev branch)", () => {
  it("saves pages first, keeps the document invisible, and never stores the PDF", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const created = await createDocumentFromPdf(tx, { sessionId: session, filename: "paper.pdf", bytes: pdf("sample.pdf") });

      expect(created).toMatchObject({ status: "ingesting", pageCount: 3 });
      const pages = await tx`select page_number, text from pages where document_id = ${created.documentId} order by page_number`;
      expect(pages.map((p) => p.page_number)).toEqual([1, 2, 3]);
      expect(pages[0]!.text).toContain("Attention Is All You Need");
      expect(await tx`select 1 from chunks where document_id = ${created.documentId}`).toHaveLength(0);

      // Not 'ready', so retrieval must not see it.
      expect(await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: probe, queryText: "Attention" })).toEqual([]);

      // No column in these tables can hold the file itself.
      const binary = await tx`
        select column_name from information_schema.columns
        where table_name in ('documents', 'pages') and data_type = 'bytea'`;
      expect(binary).toHaveLength(0);
    });
  });

  it("ingests in page batches, tags chunks with their page, and becomes ready only at the end", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: session, filename: "paper.pdf", bytes: pdf("sample.pdf") });
      const { llm, calls } = fakeLlm();

      const first = await ingestNextBatch(tx, llm, { sessionId: session, documentId, batchPages: 2 });
      expect(first).toMatchObject({ status: "ingesting", pagesIngested: 2, pageCount: 3, done: false });
      expect(await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: probe, queryText: "Attention" })).toEqual([]);

      const second = await ingestNextBatch(tx, llm, { sessionId: session, documentId, batchPages: 2 });
      expect(second).toMatchObject({ status: "ready", pagesIngested: 3, pageCount: 3, done: true });

      const chunks = await tx`select chunk_index, page_number, content from chunks where document_id = ${documentId} order by chunk_index`;
      expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i)); // contiguous across batches
      expect(chunks.map((c) => c.page_number)).toEqual([1, 2, 3]);
      expect(chunks[1]!.content).toContain("Tingkat inflasi");
      expect(calls.map((c) => c.task)).toEqual(["document", "document"]);

      // Ready, so the chunks are now searchable and carry their page numbers.
      const found = await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: probe, queryText: "inflasi tahunan" });
      expect(found.length).toBe(3);
      expect(found.find((c) => c.content.includes("Tingkat inflasi"))!.pageNumber).toBe(2);
    });
  });

  it("returns the finished state without writing when called again", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: session, filename: "p.pdf", bytes: pdf("sample.pdf") });
      const { llm, calls } = fakeLlm();
      await ingestNextBatch(tx, llm, { sessionId: session, documentId });
      expect(calls).toHaveLength(1);
      const again = await ingestNextBatch(tx, llm, { sessionId: session, documentId });
      expect(again).toMatchObject({ status: "ready", done: true });
      expect(calls).toHaveLength(1); // no further embedding call
      expect(await tx`select 1 from chunks where document_id = ${documentId}`).toHaveLength(3);
    });
  });

  it("marks a scanned PDF no_text straight away, with no pages or chunks to ingest", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const created = await createDocumentFromPdf(tx, { sessionId: session, filename: "scan.pdf", bytes: pdf("scanned.pdf") });
      expect(created).toMatchObject({ status: "no_text", pageCount: 2 });
      expect(await tx`select 1 from pages where document_id = ${created.documentId}`).toHaveLength(0);
      const [doc] = await tx`select status from documents where id = ${created.documentId}`;
      expect(doc!.status).toBe("no_text");
      const { llm, calls } = fakeLlm();
      expect(await ingestNextBatch(tx, llm, { sessionId: session, documentId: created.documentId })).toMatchObject({
        status: "no_text",
        done: true,
      });
      expect(calls).toHaveLength(0);
    });
  });

  it("writes nothing when a batch fails, and a retry then succeeds", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: session, filename: "p.pdf", bytes: pdf("sample.pdf") });
      const { llm } = fakeLlm({ failOnCall: 2 });

      await ingestNextBatch(tx, llm, { sessionId: session, documentId, batchPages: 2 }); // pages 1-2 ok
      await expect(ingestNextBatch(tx, llm, { sessionId: session, documentId, batchPages: 2 })).rejects.toBeInstanceOf(
        LlmUnavailableError,
      );

      const [doc] = await tx`select status, pages_ingested from documents where id = ${documentId}`;
      expect(doc).toMatchObject({ status: "ingesting", pages_ingested: 2 }); // unchanged by the failure
      expect(await tx`select 1 from chunks where document_id = ${documentId}`).toHaveLength(2);

      const retried = await ingestNextBatch(tx, llm, { sessionId: session, documentId, batchPages: 2 });
      expect(retried).toMatchObject({ status: "ready", done: true });
      expect(await tx`select 1 from chunks where document_id = ${documentId}`).toHaveLength(3);
    });
  });

  it("does not double-write when two requests overlap on the same batch", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: session, filename: "p.pdf", bytes: pdf("sample.pdf") });

      // While the outer call is embedding, a second request completes the same batch first.
      let inner: Promise<unknown> | undefined;
      const { llm: innerLlm } = fakeLlm();
      const { llm: outerLlm } = fakeLlm({
        onEmbed: async () => {
          if (!inner) inner = ingestNextBatch(tx, innerLlm, { sessionId: session, documentId, batchPages: 10 });
          await inner;
        },
      });

      const outer = await ingestNextBatch(tx, outerLlm, { sessionId: session, documentId, batchPages: 10 });
      expect(outer).toMatchObject({ status: "ready", done: true });
      expect(await tx`select 1 from chunks where document_id = ${documentId}`).toHaveLength(3); // not 6
    });
  });

  it("abandonDocument removes the document, its pages and its chunks", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: session, filename: "p.pdf", bytes: pdf("sample.pdf") });
      await ingestNextBatch(tx, fakeLlm().llm, { sessionId: session, documentId, batchPages: 2 });

      expect(await abandonDocument(tx, { sessionId: session, documentId })).toBe(true);
      expect(await tx`select 1 from documents where id = ${documentId}`).toHaveLength(0);
      expect(await tx`select 1 from pages where document_id = ${documentId}`).toHaveLength(0);
      expect(await tx`select 1 from chunks where document_id = ${documentId}`).toHaveLength(0);
      expect(await abandonDocument(tx, { sessionId: session, documentId })).toBe(false);
    });
  });

  it("never lets one session touch another session's document", async () => {
    await inTx(async (tx) => {
      const mine = await newSession(tx);
      const theirs = await newSession(tx);
      const { documentId } = await createDocumentFromPdf(tx, { sessionId: theirs, filename: "p.pdf", bytes: pdf("sample.pdf") });
      const { llm, calls } = fakeLlm();

      await expect(ingestNextBatch(tx, llm, { sessionId: mine, documentId })).rejects.toMatchObject({ code: "not_found" });
      expect(calls).toHaveLength(0);
      expect(await abandonDocument(tx, { sessionId: mine, documentId })).toBe(false);
      expect(await tx`select 1 from documents where id = ${documentId}`).toHaveLength(1);
    });
  });

  it("limits how many sources one session can hold", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      for (let i = 0; i < MAX_DOCUMENTS_PER_SESSION; i += 1) {
        await createDocumentFromPdf(tx, { sessionId: session, filename: `p${i}.pdf`, bytes: pdf("scanned.pdf") });
      }
      await expect(
        createDocumentFromPdf(tx, { sessionId: session, filename: "one-too-many.pdf", bytes: pdf("scanned.pdf") }),
      ).rejects.toMatchObject({ code: "too_many_documents" });
    });
  });

  it("stores nothing when the file is not a readable PDF", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      await expect(
        createDocumentFromPdf(tx, { sessionId: session, filename: "x.pdf", bytes: new TextEncoder().encode("not a pdf") }),
      ).rejects.toMatchObject({ code: "not_a_pdf" });
      expect(await tx`select 1 from documents where session_id = ${session}`).toHaveLength(0);
    });
  });

  it("cleans the filename", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const created = await createDocumentFromPdf(tx, {
        sessionId: session,
        filename: "C:\\Users\\me\\Documents\\my\u0000 paper.pdf",
        bytes: pdf("scanned.pdf"),
      });
      const [doc] = await tx`select filename from documents where id = ${created.documentId}`;
      expect(doc!.filename).toBe("my paper.pdf");
    });
  });
});
