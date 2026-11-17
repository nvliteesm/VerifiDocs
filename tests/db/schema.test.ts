// Integration tests for db/migrations. They run only against the Neon `dev` branch
// (NEON_BRANCH=dev and DATABASE_URL_UNPOOLED set); otherwise they are skipped, never run on main.
// Every test runs inside a transaction that is rolled back, so nothing is left in the database.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

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

async function seedClaim(tx: postgres.TransactionSql): Promise<{ sessionId: string; claimId: string }> {
  const [session] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  const [run] = await tx<{ id: string }[]>`
    insert into runs (session_id, draft_text, input_type)
    values (${session!.id}, 'draft', 'paste') returning id`;
  const [claim] = await tx<{ id: string }[]>`
    insert into claims (run_id, session_id, position, text)
    values (${run!.id}, ${session!.id}, 1, 'a claim') returning id`;
  return { sessionId: session!.id, claimId: claim!.id };
}

const vector = (n: number) => `[${Array.from({ length: n }, () => 0).join(",")}]`;

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("schema constraints (dev branch)", () => {
  it("rejects a Supported verdict without a quote and page", async () => {
    await expect(
      inTx(async (tx) => {
        const { sessionId, claimId } = await seedClaim(tx);
        await tx`insert into verdicts (claim_id, session_id, verdict, exit_stage)
                 values (${claimId}, ${sessionId}, 'supported', 8)`;
      }),
    ).rejects.toThrow(/supported_needs_evidence/);
  });

  it("accepts a Supported verdict with a quote and page", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimId } = await seedClaim(tx);
      await tx`insert into verdicts (claim_id, session_id, verdict, quote, page, exit_stage)
               values (${claimId}, ${sessionId}, 'supported', 'exact words', 3, 8)`;
    });
  });

  it("rejects a quote on an unverified verdict (cant_tell)", async () => {
    await expect(
      inTx(async (tx) => {
        const { sessionId, claimId } = await seedClaim(tx);
        await tx`insert into verdicts (claim_id, session_id, verdict, quote, page, exit_stage)
                 values (${claimId}, ${sessionId}, 'cant_tell', 'unverified words', 3, 8)`;
      }),
    ).rejects.toThrow(/only_verified_verdicts_carry_quote/);
  });

  it("rejects a fix suggestion on a Supported verdict", async () => {
    await expect(
      inTx(async (tx) => {
        const { sessionId, claimId } = await seedClaim(tx);
        await tx`insert into verdicts (claim_id, session_id, verdict, quote, page, fix_suggestion, exit_stage)
                 values (${claimId}, ${sessionId}, 'supported', 'q', 1, 'fix', 8)`;
      }),
    ).rejects.toThrow(/fix_only_for_partial_or_contradicted/);
  });

  it("allows only one verdict per claim", async () => {
    await expect(
      inTx(async (tx) => {
        const { sessionId, claimId } = await seedClaim(tx);
        await tx`insert into verdicts (claim_id, session_id, verdict, exit_stage)
                 values (${claimId}, ${sessionId}, 'cant_tell', 8)`;
        await tx`insert into verdicts (claim_id, session_id, verdict, exit_stage)
                 values (${claimId}, ${sessionId}, 'not_in_sources', 7)`;
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("stores 768-dimension embeddings and rejects other sizes", async () => {
    await inTx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
      const [doc] = await tx<{ id: string }[]>`
        insert into documents (session_id, filename) values (${session!.id}, 'a.pdf') returning id`;
      await tx`insert into chunks (document_id, chunk_index, page_number, content, embedding)
               values (${doc!.id}, 0, 1, 'hello', ${vector(768)}::vector)`;
    });
    await expect(
      inTx(async (tx) => {
        const [session] = await tx<{ id: string }[]>`
          insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
        const [doc] = await tx<{ id: string }[]>`
          insert into documents (session_id, filename) values (${session!.id}, 'a.pdf') returning id`;
        await tx`insert into chunks (document_id, chunk_index, page_number, content, embedding)
                 values (${doc!.id}, 0, 1, 'hello', ${vector(3)}::vector)`;
      }),
    ).rejects.toThrow(/expected 768 dimensions/);
  });

  it("full-text search matches English and Bahasa Indonesia words", async () => {
    await inTx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
      const [doc] = await tx<{ id: string }[]>`
        insert into documents (session_id, filename) values (${session!.id}, 'a.pdf') returning id`;
      await tx`insert into chunks (document_id, chunk_index, page_number, content, embedding)
               values (${doc!.id}, 0, 1, 'Tingkat inflasi tahunan naik menjadi 5 persen', ${vector(768)}::vector),
                      (${doc!.id}, 1, 2, 'Annual inflation rose to 5 percent', ${vector(768)}::vector)`;
      const id = await tx<{ chunk_index: number }[]>`
        select chunk_index from chunks
        where document_id = ${doc!.id} and fts @@ plainto_tsquery('simple', 'inflasi')`;
      const en = await tx<{ chunk_index: number }[]>`
        select chunk_index from chunks
        where document_id = ${doc!.id} and fts @@ plainto_tsquery('simple', 'inflation')`;
      expect(id.map((row) => row.chunk_index)).toEqual([0]);
      expect(en.map((row) => row.chunk_index)).toEqual([1]);
    });
  });

  it("purge_expired removes expired runs with their claims and verdicts, and keeps fresh ones", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimId } = await seedClaim(tx);
      await tx`insert into verdicts (claim_id, session_id, verdict, exit_stage)
               values (${claimId}, ${sessionId}, 'cant_tell', 8)`;
      const [fresh] = await tx<{ id: string }[]>`
        insert into runs (session_id, draft_text, input_type)
        values (${sessionId}, 'fresh', 'paste') returning id`;
      await tx`update runs set expires_at = now() - interval '1 day'
               where id = (select run_id from claims where id = ${claimId})`;

      await tx`select * from purge_expired()`;

      const claims = await tx`select id from claims where id = ${claimId}`;
      const verdicts = await tx`select id from verdicts where claim_id = ${claimId}`;
      const freshRun = await tx`select id from runs where id = ${fresh!.id}`;
      expect(claims.length).toBe(0);
      expect(verdicts.length).toBe(0);
      expect(freshRun.length).toBe(1);
    });
  });
});
