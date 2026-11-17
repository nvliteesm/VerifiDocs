// Stage 9 against the Neon `dev` branch. Skipped unless NEON_BRANCH=dev.
// Each test runs in a transaction that is rolled back.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getVerdict, saveVerdict, type SaveVerdictArgs } from "../../src/lib/pipeline/save-verdict";

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

async function seed(tx: postgres.TransactionSql, options: { claims?: number; runStatus?: string } = {}) {
  const [session] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  const [run] = await tx<{ id: string }[]>`
    insert into runs (session_id, draft_text, input_type, status)
    values (${session!.id}, 'draft', 'paste', ${options.runStatus ?? "checking"}) returning id`;
  const claimIds: string[] = [];
  for (let i = 1; i <= (options.claims ?? 1); i += 1) {
    const [claim] = await tx<{ id: string }[]>`
      insert into claims (run_id, session_id, position, text)
      values (${run!.id}, ${session!.id}, ${i}, ${`A secret claim sentence number ${i}`}) returning id`;
    claimIds.push(claim!.id);
  }
  return { sessionId: session!.id, runId: run!.id, claimIds };
}

const base = (sessionId: string, claimId: string, over: Partial<SaveVerdictArgs> = {}): SaveVerdictArgs => ({
  sessionId,
  claimId,
  verdict: "supported",
  quote: "A private quote copied from the source text",
  page: 4,
  chunkId: null,
  reason: "A private reason sentence.",
  exitStage: 7,
  fixSuggestion: null,
  latencyMs: 1234.6,
  retries: 1,
  ...over,
});

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("saveVerdict (dev branch)", () => {
  it("saves the verdict, marks the claim done, and logs claim_checked with ids and counts only", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx);
      const saved = await saveVerdict(tx, base(sessionId, claimIds[0]!));

      expect(saved).toMatchObject({ verdict: "supported", page: 4, exitStage: 7, created: true });
      expect(saved.quote).toBe("A private quote copied from the source text");
      const [claim] = await tx`select status from claims where id = ${claimIds[0]!}`;
      expect(claim!.status).toBe("done");

      const events = await tx`select name, props, session_id from events where session_id = ${sessionId} order by id`;
      expect(events.map((e) => e.name)).toEqual(["claim_checked", "run_completed"]);
      expect(events[0]!.props).toEqual({ verdict: "supported", exit_stage: 7, latency_ms: 1235, retries: 1 });
    });
  });

  it("never lets the quote, the reason or the claim text into an event", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx);
      await saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "partial", fixSuggestion: "A private fix sentence." }));
      const events = await tx`select props from events where session_id = ${sessionId}`;
      const everything = JSON.stringify(events);
      for (const secret of ["private quote", "private reason", "secret claim", "private fix"]) {
        expect(everything).not.toContain(secret);
      }
    });
  });

  it("logs fix_suggested only when a fix is saved", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, { claims: 2 });
      await saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "partial", fixSuggestion: "A fix." }));
      await saveVerdict(tx, base(sessionId, claimIds[1]!, { verdict: "contradicted", fixSuggestion: null }));
      const events = await tx`select name, props from events where session_id = ${sessionId} and name = 'fix_suggested'`;
      expect(events).toHaveLength(1);
      expect(events[0]!.props).toEqual({ verdict: "partial" });
    });
  });

  it("is idempotent: the first verdict wins, and nothing is logged twice", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, { claims: 2 });
      const first = await saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "supported" }));
      const second = await saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "contradicted", quote: "Another quote entirely here" }));

      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, verdict: "supported" });
      expect(await tx`select 1 from verdicts where claim_id = ${claimIds[0]!}`).toHaveLength(1);
      const checked = await tx`select 1 from events where session_id = ${sessionId} and name = 'claim_checked'`;
      expect(checked).toHaveLength(1);
    });
  });

  it("closes the run and logs run_completed once, when the last claim gets a verdict", async () => {
    await inTx(async (tx) => {
      const { sessionId, runId, claimIds } = await seed(tx, { claims: 2 });

      const first = await saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "supported" }));
      expect(first.runCompleted).toBe(false);
      expect((await tx`select status from runs where id = ${runId}`)[0]!.status).toBe("checking");

      const second = await saveVerdict(
        tx,
        base(sessionId, claimIds[1]!, { verdict: "not_in_sources", quote: null, page: null, exitStage: 7 }),
      );
      expect(second.runCompleted).toBe(true);
      const [run] = await tx`select status, completed_at from runs where id = ${runId}`;
      expect(run!.status).toBe("completed");
      expect(run!.completed_at).not.toBeNull();

      // Saving again must not close the run, or log it, a second time.
      const again = await saveVerdict(tx, base(sessionId, claimIds[1]!, { verdict: "partial" }));
      expect(again.runCompleted).toBe(false);
      const completed = await tx`select props from events where session_id = ${sessionId} and name = 'run_completed'`;
      expect(completed).toHaveLength(1);
      expect(completed[0]!.props.verdict_counts).toEqual({ supported: 1, not_in_sources: 1 });
      expect(typeof completed[0]!.props.duration_ms).toBe("number");
    });
  });

  it("does not close a run that is still extracting claims", async () => {
    await inTx(async (tx) => {
      const { sessionId, runId, claimIds } = await seed(tx, { runStatus: "extracting" });
      const saved = await saveVerdict(tx, base(sessionId, claimIds[0]!));
      expect(saved.runCompleted).toBe(false);
      expect((await tx`select status from runs where id = ${runId}`)[0]!.status).toBe("extracting");
      expect(await tx`select 1 from events where session_id = ${sessionId} and name = 'run_completed'`).toHaveLength(0);
    });
  });

  it("refuses a verdict the database rules reject, and leaves nothing half-written", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx);
      await expect(
        saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "supported", quote: null, page: null })),
      ).rejects.toThrow(/supported_needs_evidence/);
      await expect(
        saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "cant_tell", quote: "A quote on an unverified verdict" })),
      ).rejects.toThrow(/only_verified_verdicts_carry_quote/);
      await expect(
        saveVerdict(tx, base(sessionId, claimIds[0]!, { verdict: "supported", fixSuggestion: "A fix on a supported claim" })),
      ).rejects.toThrow(/fix_only_for_partial_or_contradicted/);

      expect(await tx`select 1 from verdicts where claim_id = ${claimIds[0]!}`).toHaveLength(0);
      expect((await tx`select status from claims where id = ${claimIds[0]!}`)[0]!.status).toBe("pending");
      expect(await tx`select 1 from events where session_id = ${sessionId}`).toHaveLength(0);
    });
  });

  it("never saves for another session's claim", async () => {
    await inTx(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);
      await expect(saveVerdict(tx, base(mine.sessionId, theirs.claimIds[0]!))).rejects.toThrow(/not found for this session/);
      expect(await getVerdict(tx, { sessionId: mine.sessionId, claimId: theirs.claimIds[0]! })).toBeNull();
    });
  });

  it("getVerdict returns null before a verdict exists and the saved verdict after", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx);
      expect(await getVerdict(tx, { sessionId, claimId: claimIds[0]! })).toBeNull();
      await saveVerdict(tx, base(sessionId, claimIds[0]!));
      expect(await getVerdict(tx, { sessionId, claimId: claimIds[0]! })).toMatchObject({ verdict: "supported", created: false });
    });
  });
});
