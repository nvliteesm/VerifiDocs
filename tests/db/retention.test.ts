// purgeNow against the Neon `dev` branch: it deletes what has expired and reports counts. Skipped unless
// NEON_BRANCH=dev. Each test runs in a transaction that is rolled back.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { purgeNow } from "../../src/lib/retention";

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

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("purgeNow (dev branch)", () => {
  it("deletes an expired run and keeps a fresh one, and counts what it deleted", async () => {
    await inTx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
      const [expired] = await tx<{ id: string }[]>`
        insert into runs (session_id, draft_text, input_type, expires_at)
        values (${session!.id}, 'old draft', 'paste', now() - interval '1 day') returning id`;
      const [fresh] = await tx<{ id: string }[]>`
        insert into runs (session_id, draft_text, input_type) values (${session!.id}, 'new draft', 'paste') returning id`;

      const result = await purgeNow(tx);

      expect(result.runsDeleted).toBeGreaterThanOrEqual(1);
      expect(result.documentsDeleted).toBeGreaterThanOrEqual(0);
      expect(await tx`select id from runs where id = ${expired!.id}`).toHaveLength(0);
      expect(await tx`select id from runs where id = ${fresh!.id}`).toHaveLength(1);
    });
  });

  it("says zero for what it did not delete, and does not throw when nothing has expired", async () => {
    await inTx(async (tx) => {
      await purgeNow(tx); // clear anything already expired on the dev branch, inside this transaction
      expect(await purgeNow(tx)).toEqual({ runsDeleted: 0, documentsDeleted: 0, sessionsDeleted: 0 });
    });
  });
});
