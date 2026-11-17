// Hybrid retrieval against a small fixture on the Neon `dev` branch. Skipped unless NEON_BRANCH=dev.
// Every test runs in a transaction that is rolled back. Embeddings are hand-made unit vectors, so
// the vector ranking is known exactly and no Gemini call is needed.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/llm/adapter";
import { toVectorLiteral } from "../../src/lib/rag/embed";
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

/** A vector with weight on up to two axes. oneHot(0) is the query direction used below. */
function axes(weights: Record<number, number>): number[] {
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const [axis, weight] of Object.entries(weights)) v[Number(axis)] = weight;
  return v;
}

async function newSession(tx: postgres.TransactionSql): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  return row!.id;
}

async function newDocument(
  tx: postgres.TransactionSql,
  sessionId: string,
  status = "ready",
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into documents (session_id, filename, status)
    values (${sessionId}, 'source.pdf', ${status}) returning id`;
  return row!.id;
}

async function addChunk(
  tx: postgres.TransactionSql,
  documentId: string,
  index: number,
  page: number,
  content: string,
  embedding: number[],
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into chunks (document_id, chunk_index, page_number, content, embedding)
    values (${documentId}, ${index}, ${page}, ${content}, ${toVectorLiteral(embedding)}::vector)
    returning id`;
  return row!.id;
}

const query = axes({ 0: 1 });

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("retrieveTopChunks (dev branch)", () => {
  it("fuses both arms: a chunk found by vector and text beats one found by a single arm", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      const both = await addChunk(tx, doc, 0, 4, "Tingkat inflasi tahunan naik menjadi lima persen", axes({ 0: 1 }));
      const vectorOnly = await addChunk(tx, doc, 1, 5, "Suku bunga acuan tetap tidak berubah", axes({ 0: 0.9, 1: 0.436 }));
      const textOnly = await addChunk(tx, doc, 2, 6, "Inflasi tahunan dilaporkan oleh badan statistik", axes({ 2: 1 }));
      const neither = await addChunk(tx, doc, 3, 7, "Cuaca cerah di Jakarta", axes({ 3: 1 }));

      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "inflasi tahunan",
      });

      const order = results.map((r) => r.chunkId);
      expect(order[0]).toBe(both);
      expect(order.indexOf(textOnly)).toBeLessThan(order.indexOf(neither));
      expect(order.indexOf(vectorOnly)).toBeLessThan(order.indexOf(neither));

      const byId = new Map(results.map((r) => [r.chunkId, r]));
      expect(byId.get(both)).toMatchObject({ vectorRank: 1, pageNumber: 4 });
      expect(byId.get(both)!.textRank).not.toBeNull();
      expect(byId.get(vectorOnly)!.textRank).toBeNull();
      expect(byId.get(textOnly)!.textRank).not.toBeNull();
      expect(byId.get(neither)!.textRank).toBeNull();
      expect(byId.get(both)!.score).toBeGreaterThan(byId.get(vectorOnly)!.score);
    });
  });

  it("finds a text-only match even when its vector is unrelated to the query", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      // Eight chunks whose vectors point at the query, plus one that only the keywords find.
      for (let i = 0; i < 8; i += 1) {
        await addChunk(tx, doc, i, 1, `filler paragraph number ${i} about weather`, axes({ 0: 1, 1: 0.01 * (i + 1) }));
      }
      const keyword = await addChunk(tx, doc, 8, 9, "Gross margin fell to 41 percent in the third quarter", axes({ 5: 1 }));

      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "gross margin fell",
        limit: 5,
      });
      expect(results.map((r) => r.chunkId)).toContain(keyword);
    });
  });

  it("returns at most 5 chunks by default and honours a smaller limit", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      for (let i = 0; i < 8; i += 1) {
        await addChunk(tx, doc, i, 1, `chunk ${i} text`, axes({ 0: 1, 1: 0.1 * i }));
      }
      expect(await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: query, queryText: "text" }))
        .toHaveLength(5);
      expect(
        await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: query, queryText: "text", limit: 2 }),
      ).toHaveLength(2);
    });
  });

  it("never returns another session's chunks", async () => {
    await inTx(async (tx) => {
      const mine = await newSession(tx);
      const theirs = await newSession(tx);
      const myDoc = await newDocument(tx, mine);
      const theirDoc = await newDocument(tx, theirs);
      const myChunk = await addChunk(tx, myDoc, 0, 1, "shared wording about inflation", axes({ 0: 1 }));
      await addChunk(tx, theirDoc, 0, 1, "shared wording about inflation", axes({ 0: 1 }));

      const results = await retrieveTopChunks(tx, {
        sessionId: mine,
        queryEmbedding: query,
        queryText: "shared wording about inflation",
      });
      expect(results.map((r) => r.chunkId)).toEqual([myChunk]);
    });
  });

  it("ignores documents that are not ready (still ingesting, failed, or no text)", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const ready = await newDocument(tx, session, "ready");
      const readyChunk = await addChunk(tx, ready, 0, 1, "the report states inflation", axes({ 0: 1 }));
      for (const status of ["ingesting", "failed", "no_text"]) {
        const doc = await newDocument(tx, session, status);
        await addChunk(tx, doc, 0, 1, "the report states inflation", axes({ 0: 1 }));
      }
      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "report states inflation",
      });
      expect(results.map((r) => r.chunkId)).toEqual([readyChunk]);
    });
  });

  it("can be limited to specific documents", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const docA = await newDocument(tx, session);
      const docB = await newDocument(tx, session);
      const chunkA = await addChunk(tx, docA, 0, 1, "alpha statement about rates", axes({ 0: 1 }));
      await addChunk(tx, docB, 0, 1, "beta statement about rates", axes({ 0: 1 }));

      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "statement about rates",
        documentIds: [docA],
      });
      expect(results.map((r) => r.chunkId)).toEqual([chunkA]);
    });
  });

  it("still returns vector matches when the query has no usable keywords", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      const chunk = await addChunk(tx, doc, 0, 3, "some passage", axes({ 0: 1 }));
      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "the of and",
      });
      expect(results.map((r) => r.chunkId)).toEqual([chunk]);
      expect(results[0]!.textRank).toBeNull();
    });
  });

  it("does not choke on punctuation or query operators in the claim text", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      await addChunk(tx, doc, 0, 1, "rate was 5 percent", axes({ 0: 1 }));
      const results = await retrieveTopChunks(tx, {
        sessionId: session,
        queryEmbedding: query,
        queryText: "rate & (5 | !percent) :* ' ; -- \"x\"",
      });
      expect(results).toHaveLength(1);
    });
  });

  it("returns nothing for a session with no sources", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      expect(
        await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: query, queryText: "anything" }),
      ).toEqual([]);
    });
  });

  it("breaks ties by upload order and chunk position, not by random id", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await newDocument(tx, session);
      // Identical text and vectors, so every score ties. Inserted out of order, with random uuids.
      for (const index of [2, 0, 3, 1]) await addChunk(tx, doc, index, 1, "an identical passage about rates", axes({ 0: 1 }));

      for (let repeat = 0; repeat < 3; repeat += 1) {
        const results = await retrieveTopChunks(tx, { sessionId: session, queryEmbedding: query, queryText: "identical passage rates" });
        expect(results.map((r) => r.chunkIndex)).toEqual([0, 1, 2, 3]);
      }
    });
  });
});
