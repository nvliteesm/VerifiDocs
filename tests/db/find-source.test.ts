// Stage 4 against a fixture on the Neon `dev` branch. Skipped unless NEON_BRANCH=dev.
// Each test runs in a transaction that is rolled back.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { findSourceDocument } from "../../src/lib/pipeline/find-source";

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

async function addDocument(
  tx: postgres.TransactionSql,
  sessionId: string,
  filename: string,
  status: string,
  pages: string[],
): Promise<string> {
  const [doc] = await tx<{ id: string }[]>`
    insert into documents (session_id, filename, status) values (${sessionId}, ${filename}, ${status}) returning id`;
  for (const [i, text] of pages.entries()) {
    await tx`insert into pages (document_id, page_number, text) values (${doc!.id}, ${i + 1}, ${text})`;
  }
  return doc!.id;
}

afterAll(async () => {
  await sql?.end();
});

const TITLE = "Attention Is All You Need";

describe.skipIf(!enabled)("findSourceDocument (dev branch)", () => {
  it("returns none for a session with no uploaded sources", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "none" });
    });
  });

  it("matches by the title printed on the first page", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await addDocument(tx, session, "paper.pdf", "ready", [
        "Attention Is All You Need\nAshish Vaswani et al. Abstract. The dominant sequence transduction models",
      ]);
      await addDocument(tx, session, "other.pdf", "ready", ["A different paper about weather"]);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "found", documentId: doc });
    });
  });

  it("matches a title split across lines and with different capitalisation and punctuation", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await addDocument(tx, session, "x.pdf", "ready", ["ATTENTION IS ALL\nYOU NEED -- abstract follows"]);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "found", documentId: doc });
    });
  });

  it("matches by DOI printed in the first pages, even if the title differs", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await addDocument(tx, session, "x.pdf", "ready", ["Preprint copy. DOI: 10.48550/ARXIV.1706.03762 Some other heading"]);
      expect(
        await findSourceDocument(tx, { sessionId: session, doi: "10.48550/arxiv.1706.03762", title: "A Different Title Entirely" }),
      ).toEqual({ kind: "found", documentId: doc });
    });
  });

  it("only looks at the first three pages", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      await addDocument(tx, session, "x.pdf", "ready", ["intro one", "intro two", "intro three", "Attention Is All You Need appears only here"]);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "none" });
    });
  });

  it("falls back to the filename for a scanned PDF and reports it as no_text", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const doc = await addDocument(tx, session, "Attention-Is-All-You-Need.pdf", "no_text", []);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "no_text", documentId: doc });
    });
  });

  it("prefers a readable PDF over a scan when both match", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      await addDocument(tx, session, "attention is all you need scan.pdf", "no_text", []);
      const readable = await addDocument(tx, session, "copy.pdf", "ready", ["Attention Is All You Need"]);
      // The readable copy matches on title (strength 2), the scan only on filename (strength 1).
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "found", documentId: readable });
    });
  });

  it("uses a linked document without guessing, and reports its state", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const linked = await addDocument(tx, session, "whatever.pdf", "ready", ["unrelated text"]);
      await addDocument(tx, session, "match.pdf", "ready", ["Attention Is All You Need"]);
      expect(
        await findSourceDocument(tx, { sessionId: session, title: TITLE, linkedDocumentId: linked }),
      ).toEqual({ kind: "found", documentId: linked });

      const scan = await addDocument(tx, session, "scan.pdf", "no_text", []);
      expect(
        await findSourceDocument(tx, { sessionId: session, title: TITLE, linkedDocumentId: scan }),
      ).toEqual({ kind: "no_text", documentId: scan });
    });
  });

  it("ignores a linked document that is still ingesting or failed", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      const busy = await addDocument(tx, session, "x.pdf", "ingesting", ["Attention Is All You Need"]);
      expect(
        await findSourceDocument(tx, { sessionId: session, title: TITLE, linkedDocumentId: busy }),
      ).toEqual({ kind: "none" });
    });
  });

  it("never returns another session's document, linked or found by search", async () => {
    await inTx(async (tx) => {
      const mine = await newSession(tx);
      const theirs = await newSession(tx);
      const theirDoc = await addDocument(tx, theirs, "x.pdf", "ready", ["Attention Is All You Need"]);
      expect(await findSourceDocument(tx, { sessionId: mine, title: TITLE })).toEqual({ kind: "none" });
      expect(
        await findSourceDocument(tx, { sessionId: mine, title: TITLE, linkedDocumentId: theirDoc }),
      ).toEqual({ kind: "none" });
    });
  });

  it("ignores documents that are still ingesting or failed when searching", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      await addDocument(tx, session, "a.pdf", "ingesting", ["Attention Is All You Need"]);
      await addDocument(tx, session, "b.pdf", "failed", ["Attention Is All You Need"]);
      expect(await findSourceDocument(tx, { sessionId: session, title: TITLE })).toEqual({ kind: "none" });
    });
  });

  it("does not match on a one-word title", async () => {
    await inTx(async (tx) => {
      const session = await newSession(tx);
      await addDocument(tx, session, "inflation.pdf", "ready", ["Inflation is discussed here"]);
      expect(await findSourceDocument(tx, { sessionId: session, title: "Inflation" })).toEqual({ kind: "none" });
    });
  });
});
