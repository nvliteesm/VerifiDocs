// Stages 3 to 9 for one claim against the Neon `dev` branch, with a fake model client and a fake reference
// lookup. Skipped unless NEON_BRANCH=dev. Each test runs in a transaction that is rolled back.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  LlmOutputError,
  LlmUnavailableError,
  type GenerateJsonRequest,
  type Llm,
} from "../../src/lib/llm/adapter";
import { MAX_CLAIM_ATTEMPTS, checkClaim } from "../../src/lib/pipeline/claim-check";
import type { RawJudgment } from "../../src/lib/pipeline/judge";
import type { ReferenceResolution } from "../../src/lib/pipeline/resolve-reference";
import { toVectorLiteral } from "../../src/lib/rag/embed";

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

const probe = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const SOURCE_TEXT = "The survey had 300 respondents across three regions of the country.";
const TITLE = "Inflation and household spending";
const ENTRY_1 = `Smith, J., & Lee, K. (2021). ${TITLE}. Journal of Economics, 12(3), 45-67.`;
const ENTRY_2 = "Brown, T. (2018). A study with no uploaded source file. Journal of Missing Files.";

const found = (title: string): ReferenceResolution => ({
  status: "found", resolver: "crossref", doi: "10.1/x", title, year: 2021, yearMismatch: false,
});

interface Script {
  /** Called for each judge request; return a judgment or throw. */
  judge?: (call: number) => RawJudgment;
  /** Called for each fix request; return a sentence or throw. */
  fix?: (call: number) => string;
}

function fakeLlm(script: Script = {}) {
  const prompts: string[] = [];
  let judgeCalls = 0;
  let fixCalls = 0;
  let embedCalls = 0;
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      prompts.push(request.prompt);
      if (request.prompt.includes("Decide whether the passages support the claim")) {
        judgeCalls += 1;
        const answer = (script.judge ?? (() => { throw new Error("unexpected judge call"); }))(judgeCalls);
        return request.schema.parse(answer);
      }
      fixCalls += 1;
      return request.schema.parse({ sentence: (script.fix ?? (() => ""))(fixCalls) });
    },
    async embed(texts) {
      if (texts.length > 0) embedCalls += 1;
      return texts.map(() => [...probe]);
    },
  };
  return { llm, prompts, counts: () => ({ judge: judgeCalls, fix: fixCalls, embed: embedCalls }) };
}

const supportedJudgment: RawJudgment = {
  verdict: "supported",
  quote: "The survey had 300 respondents across three regions",
  page: 4,
  chunk_id: "P1",
  reason: "The source says so.",
};

/** A session with a run, two reference entries, a ready source whose first page carries ENTRY_1's title, and one chunk. */
async function seed(tx: postgres.TransactionSql, claims: { text: string; citation: string | null }[]) {
  const [session] = await tx<{ id: string }[]>`
    insert into sessions (token_hash) values (${`hash-${Math.random()}`}) returning id`;
  const sessionId = session!.id;
  const [run] = await tx<{ id: string }[]>`
    insert into runs (session_id, draft_text, input_type, status) values (${sessionId}, 'draft', 'paste', 'checking') returning id`;
  await tx`insert into reference_entries (run_id, session_id, raw_text, position) values (${run!.id}, ${sessionId}, ${ENTRY_1}, 1)`;
  await tx`insert into reference_entries (run_id, session_id, raw_text, position) values (${run!.id}, ${sessionId}, ${ENTRY_2}, 2)`;

  const [doc] = await tx<{ id: string }[]>`
    insert into documents (session_id, filename, page_count, pages_ingested, status)
    values (${sessionId}, 'paper.pdf', 4, 4, 'ready') returning id`;
  await tx`insert into pages (document_id, page_number, text) values (${doc!.id}, 1, ${`${TITLE} Smith Lee abstract`})`;
  await tx`
    insert into chunks (document_id, chunk_index, page_number, content, embedding)
    values (${doc!.id}, 0, 4, ${SOURCE_TEXT}, ${toVectorLiteral(probe)}::vector)`;

  const claimIds: string[] = [];
  for (const [i, claim] of claims.entries()) {
    const [row] = await tx<{ id: string }[]>`
      insert into claims (run_id, session_id, position, text, citation_text)
      values (${run!.id}, ${sessionId}, ${i + 1}, ${claim.text}, ${claim.citation}) returning id`;
    claimIds.push(row!.id);
  }
  return { sessionId, runId: run!.id, docId: doc!.id, claimIds };
}

const CLAIM = { text: "The survey had 500 respondents.", citation: "(Smith & Lee, 2021)" };

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!enabled)("checkClaim (dev branch)", () => {
  it("runs the whole path: a verified quote gives Supported with its page, and the run closes", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm, counts } = fakeLlm({ judge: () => supportedJudgment });

      const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });

      expect(result.outcome).toBe("done");
      if (result.outcome !== "done") return;
      expect(result.verdict).toMatchObject({
        verdict: "supported", page: 4, exitStage: 7, created: true, runCompleted: true,
        quote: "The survey had 300 respondents across three regions",
      });
      expect(counts()).toEqual({ judge: 1, fix: 0, embed: 1 });
      const events = await tx`select name from events where session_id = ${sessionId} order by id`;
      expect(events.map((e) => e.name)).toEqual(["claim_checked", "run_completed"]);
    });
  });

  it("ends a claim with no citation as No citation given, without any lookup or model call", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "Turnover rose by 23 percent.", citation: null }]);
      const { llm, counts } = fakeLlm();
      let lookups = 0;
      const result = await checkClaim(tx, { llm, resolve: async () => { lookups += 1; return found(TITLE); } }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "no_citation_given", exitStage: 2 } });
      expect(lookups).toBe(0);
      expect(counts()).toEqual({ judge: 0, fix: 0, embed: 0 });
    });
  });

  it("ends a citation that is not in the reference list as Reference not found, without a lookup", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "Rates rose in 2019.", citation: "(Jones, 2019)" }]);
      let lookups = 0;
      const result = await checkClaim(tx, { llm: fakeLlm().llm, resolve: async () => { lookups += 1; return found(TITLE); } }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "reference_not_found", exitStage: 3 } });
      expect(result.outcome === "done" && result.verdict.reason).toMatch(/not in your reference list/);
      expect(lookups).toBe(0);
    });
  });

  it("ends an entry that Crossref and OpenAlex do not know as Reference not found", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [CLAIM]);
      const result = await checkClaim(tx, { llm: fakeLlm().llm, resolve: async () => ({ status: "not_found" }) }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "reference_not_found", exitStage: 3 } });
    });
  });

  it("looks each reference up once per run, however many claims cite it", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [
        { text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" },
        { text: "Respondents came from three regions.", citation: "(Smith & Lee, 2021)" },
      ]);
      let lookups = 0;
      const deps = { llm: fakeLlm({ judge: () => supportedJudgment }).llm, resolve: async () => { lookups += 1; return found(TITLE); } };
      await checkClaim(tx, deps, { sessionId, claimId: claimIds[0]! });
      await checkClaim(tx, deps, { sessionId, claimId: claimIds[1]! });
      expect(lookups).toBe(1);
    });
  });

  it("ends a real reference with no uploaded source as Can't check", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "Some finding was reported.", citation: "(Brown, 2018)" }]);
      const { llm, counts } = fakeLlm();
      const result = await checkClaim(tx, { llm, resolve: async () => found("A study with no uploaded source file") }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "cant_check", exitStage: 4 } });
      expect(counts().judge).toBe(0);
    });
  });

  it("asks for a retry when a lookup fails, and gives up with Can't tell after the allowed attempts", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [CLAIM]);
      const deps = { llm: fakeLlm().llm, resolve: async (): Promise<ReferenceResolution> => ({ status: "error", reason: "Crossref returned HTTP 503" }) };
      const args = { sessionId, claimId: claimIds[0]! };

      for (let attempt = 1; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
        expect(await checkClaim(tx, deps, args)).toEqual({ outcome: "retry", reason: "Crossref returned HTTP 503", attempt });
        expect((await tx`select status from claims where id = ${claimIds[0]!}`)[0]!.status).toBe("checking");
      }
      const last = await checkClaim(tx, deps, args);
      expect(last).toMatchObject({ outcome: "done", verdict: { verdict: "cant_tell", exitStage: 3 } });
      expect(last.outcome === "done" && last.verdict.reason).toMatch(/after 3 attempts: Crossref returned HTTP 503/);
      const [event] = await tx`select props from events where session_id = ${sessionId} and name = 'claim_checked'`;
      expect(event!.props.retries).toBe(MAX_CLAIM_ATTEMPTS - 1);
    });
  });

  it("retries when the model fails, and succeeds on the next attempt", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({
        judge: (call) => {
          if (call === 1) throw new LlmUnavailableError("The Gemini API request failed (HTTP 503).", 503);
          if (call === 2) throw new LlmOutputError("Gemini output rejected after 2 attempts: not valid JSON.");
          return supportedJudgment;
        },
      });
      const deps = { llm, resolve: async () => found(TITLE) };
      const args = { sessionId, claimId: claimIds[0]! };

      expect(await checkClaim(tx, deps, args)).toMatchObject({ outcome: "retry", attempt: 1 });
      expect(await checkClaim(tx, deps, args)).toMatchObject({ outcome: "retry", attempt: 2 });
      const third = await checkClaim(tx, deps, args);
      expect(third).toMatchObject({ outcome: "done", verdict: { verdict: "supported" } });
    });
  });

  it("turns a quote that is not in the passages into Can't tell at stage 8 and stores no quote (hard rule 1)", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({ judge: () => ({ ...supportedJudgment, quote: "The survey had 900 respondents across ten regions" }) });
      const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "cant_tell", exitStage: 8, quote: null, page: null } });
      const [row] = await tx`select quote, chunk_id from verdicts where claim_id = ${claimIds[0]!}`;
      expect(row).toMatchObject({ quote: null, chunk_id: null });
    });
  });

  it("saves a Partial verdict with a safe fix, and drops a fix that invents a number", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [
        { text: "The survey covered every region in the country (Smith & Lee, 2021).", citation: "(Smith & Lee, 2021)" },
        { text: "The survey covered most regions in the country (Smith & Lee, 2021).", citation: "(Smith & Lee, 2021)" },
      ]);
      const partial: RawJudgment = { ...supportedJudgment, verdict: "partial" };
      const { llm } = fakeLlm({
        judge: () => partial,
        fix: (call) => (call === 1
          ? "The survey had 300 respondents across three regions (Smith & Lee, 2021)."
          : "The survey had 450 respondents across three regions (Smith & Lee, 2021)."),
      });
      const deps = { llm, resolve: async () => found(TITLE) };

      const first = await checkClaim(tx, deps, { sessionId, claimId: claimIds[0]! });
      expect(first).toMatchObject({ outcome: "done", verdict: { verdict: "partial", fixSuggestion: "The survey had 300 respondents across three regions (Smith & Lee, 2021)." } });
      const second = await checkClaim(tx, deps, { sessionId, claimId: claimIds[1]! });
      expect(second).toMatchObject({ outcome: "done", verdict: { verdict: "partial", fixSuggestion: null } });
    });
  });

  it("saves Not in sources with no quote", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The programme cost less than the alternative.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({ judge: () => ({ verdict: "not_in_sources", quote: null, page: null, chunk_id: null, reason: "No passage mentions cost." }) });
      const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
      expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "not_in_sources", quote: null, page: null, exitStage: 7 } });
    });
  });

  it("only shows the judge passages from the cited source, never another source in the session", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const [other] = await tx<{ id: string }[]>`
        insert into documents (session_id, filename, page_count, pages_ingested, status) values (${sessionId}, 'other.pdf', 1, 1, 'ready') returning id`;
      await tx`insert into pages (document_id, page_number, text) values (${other!.id}, 1, 'Unrelated report')`;
      await tx`insert into chunks (document_id, chunk_index, page_number, content, embedding)
               values (${other!.id}, 0, 1, 'A passage from a different, uncited document about weather.', ${toVectorLiteral(probe)}::vector)`;

      const { llm, prompts } = fakeLlm({ judge: () => supportedJudgment });
      await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
      const judgePrompt = prompts.find((p) => p.includes("Decide whether"))!;
      expect(judgePrompt).toContain(SOURCE_TEXT);
      expect(judgePrompt).not.toContain("different, uncited document");
    });
  });

  it("returns an existing verdict without any lookup or model call", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const first = fakeLlm({ judge: () => supportedJudgment });
      const deps = { llm: first.llm, resolve: async () => found(TITLE) };
      await checkClaim(tx, deps, { sessionId, claimId: claimIds[0]! });

      const second = fakeLlm();
      let lookups = 0;
      const again = await checkClaim(tx, { llm: second.llm, resolve: async () => { lookups += 1; return found(TITLE); } }, { sessionId, claimId: claimIds[0]! });
      expect(again).toMatchObject({ outcome: "done", verdict: { verdict: "supported", created: false } });
      expect(lookups).toBe(0);
      expect(second.counts()).toEqual({ judge: 0, fix: 0, embed: 0 });
    });
  });

  it("refuses another session's claim", async () => {
    await inTx(async (tx) => {
      const mine = await seed(tx, [CLAIM]);
      const theirs = await seed(tx, [CLAIM]);
      await expect(
        checkClaim(tx, { llm: fakeLlm().llm, resolve: async () => found(TITLE) }, { sessionId: mine.sessionId, claimId: theirs.claimIds[0]! }),
      ).rejects.toThrow(/not found for this session/);
    });
  });

  it("logs only ids, counts and buckets: no claim, quote, reference or reason text reaches an event", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({ judge: () => supportedJudgment });
      await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
      const everything = JSON.stringify(await tx`select name, props from events where session_id = ${sessionId}`);
      for (const secret of ["survey", "respondents", "Smith", "Inflation and household", "The source says so"]) {
        expect(everything).not.toContain(secret);
      }
    });
  });
});
