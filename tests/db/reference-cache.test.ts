// Reference-resolution caching against the Neon `dev` branch. Skipped unless NEON_BRANCH=dev.
// Each test runs in a transaction that is rolled back.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { resolveEntryCached } from "../../src/lib/pipeline/reference-cache";
import type { ReferenceResolution } from "../../src/lib/pipeline/resolve-reference";

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

async function seedEntry(tx: postgres.TransactionSql): Promise<{ sessionId: string; entryId: string }> {
  const [session] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  const [run] = await tx<{ id: string }[]>`
    insert into runs (session_id, draft_text, input_type) values (${session!.id}, 'draft', 'paste') returning id`;
  const [entry] = await tx<{ id: string }[]>`
    insert into reference_entries (run_id, session_id, raw_text, position)
    values (${run!.id}, ${session!.id}, 'Smith, J. (2021). A title. Journal.', 1) returning id`;
  return { sessionId: session!.id, entryId: entry!.id };
}

function counter(result: ReferenceResolution) {
  let calls = 0;
  return {
    resolve: async () => {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

afterAll(async () => {
  await sql?.end();
});

const FOUND: ReferenceResolution = {
  status: "found",
  resolver: "openalex",
  doi: "10.48550/arxiv.1706.03762",
  title: "Attention Is All You Need",
  year: 2025,
  yearMismatch: true,
};

describe.skipIf(!enabled)("resolveEntryCached (dev branch)", () => {
  it("looks a found reference up once and returns every field from the cache afterwards", async () => {
    await inTx(async (tx) => {
      const { sessionId, entryId } = await seedEntry(tx);
      const lookup = counter(FOUND);

      const first = await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: lookup.resolve });
      const second = await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: lookup.resolve });
      const third = await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: lookup.resolve });

      expect(first).toEqual(FOUND);
      expect(second).toEqual(FOUND);
      expect(third).toEqual(FOUND);
      expect(lookup.calls()).toBe(1);

      const [row] = await tx`select resolution from reference_entries where id = ${entryId}`;
      expect(row!.resolution).toBe("found");
    });
  });

  it("caches not_found too", async () => {
    await inTx(async (tx) => {
      const { sessionId, entryId } = await seedEntry(tx);
      const lookup = counter({ status: "not_found" });
      await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: lookup.resolve });
      const again = await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: lookup.resolve });
      expect(again).toEqual({ status: "not_found" });
      expect(lookup.calls()).toBe(1);
    });
  });

  it("never caches a failed lookup, so the next attempt tries again", async () => {
    await inTx(async (tx) => {
      const { sessionId, entryId } = await seedEntry(tx);
      const failing = counter({ status: "error", reason: "Crossref returned HTTP 503" });
      expect(await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: failing.resolve })).toEqual({
        status: "error",
        reason: "Crossref returned HTTP 503",
      });
      expect(await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: failing.resolve })).toMatchObject({
        status: "error",
      });
      expect(failing.calls()).toBe(2);

      const [row] = await tx`select resolution from reference_entries where id = ${entryId}`;
      expect(row!.resolution).toBe("pending");

      // A later success is then cached normally.
      const working = counter(FOUND);
      await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: working.resolve });
      await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: working.resolve });
      expect(working.calls()).toBe(1);
    });
  });

  it("keeps the first saved answer when a racing claim finishes its own lookup later", async () => {
    await inTx(async (tx) => {
      const { sessionId, entryId } = await seedEntry(tx);
      // While this claim's lookup is "running", another claim saves a different answer first.
      const racing = async (): Promise<ReferenceResolution> => {
        await tx`
          update reference_entries
          set resolution = 'found', resolver = 'crossref', resolved_title = 'First writer wins',
              resolved_year = 2020, year_mismatch = false
          where id = ${entryId}`;
        return FOUND;
      };

      await resolveEntryCached(tx, { entryId, sessionId, raw: "x", resolve: racing });

      const [row] = await tx`select resolver, resolved_title, resolved_year from reference_entries where id = ${entryId}`;
      expect(row).toMatchObject({ resolver: "crossref", resolved_title: "First writer wins", resolved_year: 2020 });
    });
  });

  it("refuses another session's entry", async () => {
    await inTx(async (tx) => {
      const { entryId } = await seedEntry(tx);
      const [other] = await tx<{ id: string }[]>`
        insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
      const lookup = counter(FOUND);
      await expect(
        resolveEntryCached(tx, { entryId, sessionId: other!.id, raw: "x", resolve: lookup.resolve }),
      ).rejects.toThrow(/not found for this session/);
      expect(lookup.calls()).toBe(0);
    });
  });
});
