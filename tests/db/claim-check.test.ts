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
  /** Called for each second look at a Supported verdict; return { verdict, reason } or throw. */
  review?: (call: number) => { verdict: "supported" | "partial" | "contradicted"; reason: string };
  /** True when a review model is set. Defaults to false, as in a setup without GEMINI_REVIEW_MODEL. */
  reviewAvailable?: boolean;
}

function fakeLlm(script: Script = {}) {
  const prompts: string[] = [];
  let judgeCalls = 0;
  let fixCalls = 0;
  let embedCalls = 0;
  let reviewCalls = 0;
  const llm: Llm = {
    reviewAvailable: script.reviewAvailable ?? false,
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      prompts.push(request.prompt);
      if (request.role === "review") {
        reviewCalls += 1;
        const answer = (script.review ?? (() => { throw new Error("unexpected review call"); }))(reviewCalls);
        return request.schema.parse(answer);
      }
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
  return { llm, prompts, counts: () => ({ judge: judgeCalls, fix: fixCalls, embed: embedCalls, review: reviewCalls }) };
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
      expect(counts()).toEqual({ judge: 1, fix: 0, embed: 1, review: 0 });
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
      expect(counts()).toEqual({ judge: 0, fix: 0, embed: 0, review: 0 });
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

  it("keeps asking for a retry when a lookup fails, and never ends the claim on its own (Try again, UAT 23 Nov 2026)", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [CLAIM]);
      const deps = { llm: fakeLlm().llm, resolve: async (): Promise<ReferenceResolution> => ({ status: "error", reason: "Crossref returned HTTP 503" }) };
      const args = { sessionId, claimId: claimIds[0]! };

      for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS + 2; attempt += 1) {
        expect(await checkClaim(tx, deps, args)).toEqual({ outcome: "retry", reason: "Crossref returned HTTP 503", attempt });
      }
      expect((await tx`select status from claims where id = ${claimIds[0]!}`)[0]!.status).toBe("checking");
      expect(await tx`select 1 from verdicts where claim_id = ${claimIds[0]!}`).toHaveLength(0);
    });
  });

  it("keeps asking for a retry while the model is unavailable or times out, and saves no verdict", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({ judge: () => { throw new LlmUnavailableError("The Gemini API request timed out."); } });
      const args = { sessionId, claimId: claimIds[0]! };
      for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS + 1; attempt += 1) {
        expect(await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, args)).toMatchObject({ outcome: "retry", attempt });
      }
      expect(await tx`select 1 from verdicts where claim_id = ${claimIds[0]!}`).toHaveLength(0);
    });
  });

  it("ends as Can't tell after the allowed attempts when the model keeps giving unusable answers", async () => {
    await inTx(async (tx) => {
      const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }]);
      const { llm } = fakeLlm({ judge: () => { throw new LlmOutputError("Gemini output rejected after 2 attempts: not valid JSON."); } });
      const deps = { llm, resolve: async () => found(TITLE) };
      const args = { sessionId, claimId: claimIds[0]! };
      for (let attempt = 1; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
        expect(await checkClaim(tx, deps, args)).toMatchObject({ outcome: "retry", attempt });
      }
      const last = await checkClaim(tx, deps, args);
      expect(last).toMatchObject({ outcome: "done", verdict: { verdict: "cant_tell", exitStage: 7 } });
      expect(last.outcome === "done" && last.verdict.reason).toMatch(/after 3 attempts: Gemini output rejected/);
      const [event] = await tx`select props from events where session_id = ${sessionId} and name = 'claim_checked'`;
      expect(event!.props.retries).toBe(MAX_CLAIM_ATTEMPTS - 1);
    });
  });

  describe("a translation of the quote for an Indonesian claim (24 Nov 2026)", () => {
    const GLOSS = "Survei itu memiliki 300 responden di tiga wilayah negara.";

    it("saves the judge's translation when the claim is in Indonesian and the quote in English", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, [
          { text: "Survei tersebut memiliki 300 responden yang tersebar di tiga wilayah dari negara itu.", citation: "(Smith & Lee, 2021)" },
        ]);
        const { llm } = fakeLlm({ judge: () => ({ ...supportedJudgment, gloss: GLOSS }) });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "supported", quote: supportedJudgment.quote, quoteGloss: GLOSS } });
        const [row] = await tx`select quote_gloss from verdicts where claim_id = ${claimIds[0]!}`;
        expect(row!.quote_gloss).toBe(GLOSS);
      });
    });

    it("saves none for an English claim, even when the model sends one", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, [{ text: "The survey had 300 respondents across three regions.", citation: "(Smith & Lee, 2021)" }]);
        const { llm } = fakeLlm({ judge: () => ({ ...supportedJudgment, gloss: GLOSS }) });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "supported", quoteGloss: null } });
      });
    });
  });

  describe("the second look at a Supported verdict", () => {
    const survey = (text: string) => [{ text, citation: "(Smith & Lee, 2021)" }];

    it("turns Supported into Partly supported when the sentence's number is not in the passage, and the review agrees", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 500 respondents across three regions."));
        const { llm, counts } = fakeLlm({
          judge: () => supportedJudgment,
          review: () => ({ verdict: "partial", reason: "Only the regions are right." }),
          fix: () => "The survey had 300 respondents across three regions (Smith & Lee, 2021).",
          reviewAvailable: true,
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({
          outcome: "done",
          verdict: { verdict: "partial", exitStage: 8, page: 4, quote: supportedJudgment.quote, reason: "The source passage does not show 500 from your sentence." },
        });
        expect(result.outcome === "done" && result.verdict.fixSuggestion).toBe("The survey had 300 respondents across three regions (Smith & Lee, 2021).");
        expect(counts().review).toBe(1);
      });
    });

    it("saves Contradicted, with the verified quote and a suggested sentence, when the review finds the wrong number is the claim's main assertion", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 500 respondents."));
        const { llm, counts } = fakeLlm({
          judge: () => supportedJudgment,
          review: () => ({ verdict: "contradicted", reason: "The source says 300 respondents, not 500." }),
          fix: () => "The survey had 300 respondents (Smith & Lee, 2021).",
          reviewAvailable: true,
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({
          outcome: "done",
          verdict: { verdict: "contradicted", exitStage: 8, page: 4, quote: supportedJudgment.quote, reason: "The source says 300 respondents, not 500.", fixSuggestion: "The survey had 300 respondents (Smith & Lee, 2021)." },
        });
        expect(counts()).toMatchObject({ judge: 1, review: 1, fix: 1 });
      });
    });

    it("moves a judge's Partly supported to Contradicted when the review says so (E31 and E32 of the first eval)", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 300 respondents in every region of the world."));
        const { llm, counts } = fakeLlm({
          judge: () => ({ ...supportedJudgment, verdict: "partial" }),
          review: () => ({ verdict: "contradicted", reason: "The source says three regions." }),
          fix: () => "The survey had 300 respondents across three regions (Smith & Lee, 2021).",
          reviewAvailable: true,
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "contradicted", exitStage: 8, quote: supportedJudgment.quote } });
        expect(counts()).toMatchObject({ judge: 1, review: 1, fix: 1 });
      });
    });

    it("keeps a judge's Partly supported, at stage 7, when the review agrees or when it times out", async () => {
      await inTx(async (tx) => {
        const agrees = await seed(tx, survey("The survey had 300 respondents across all regions."));
        const a = fakeLlm({ judge: () => ({ ...supportedJudgment, verdict: "partial" }), review: () => ({ verdict: "partial", reason: "Three, not all." }), fix: () => "x", reviewAvailable: true });
        const agreed = await checkClaim(tx, { llm: a.llm, resolve: async () => found(TITLE) }, { sessionId: agrees.sessionId, claimId: agrees.claimIds[0]! });
        expect(agreed).toMatchObject({ outcome: "done", verdict: { verdict: "partial", exitStage: 7 } });
        expect(agreed).not.toHaveProperty("reviewSkipped");

        const fails = await seed(tx, survey("The survey had 300 respondents across all regions."));
        const b = fakeLlm({
          judge: () => ({ ...supportedJudgment, verdict: "partial" }),
          review: () => { throw new LlmUnavailableError("The Gemini API request timed out."); },
          fix: () => "x",
          reviewAvailable: true,
        });
        const failed = await checkClaim(tx, { llm: b.llm, resolve: async () => found(TITLE) }, { sessionId: fails.sessionId, claimId: fails.claimIds[0]! });
        // The saved verdict is unchanged; only the result carries the flag, so the eval can see the review never ran.
        expect(failed).toMatchObject({ outcome: "done", reviewSkipped: true, verdict: { verdict: "partial", exitStage: 7 } });
      });
    });

    it("saves the review model's stricter verdict, with the verified quote and a suggested sentence", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 300 respondents across every region."));
        const { llm, counts } = fakeLlm({
          judge: () => supportedJudgment,
          review: () => ({ verdict: "partial", reason: "Three regions, not every region." }),
          fix: () => "The survey had 300 respondents across three regions (Smith & Lee, 2021).",
          reviewAvailable: true,
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "partial", exitStage: 8, quote: supportedJudgment.quote, reason: "Three regions, not every region." } });
        expect(counts()).toMatchObject({ judge: 1, review: 1, fix: 1 });
      });
    });

    it("keeps Supported, at stage 7, when the review agrees", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 300 respondents across three regions."));
        const { llm, counts } = fakeLlm({ judge: () => supportedJudgment, review: () => ({ verdict: "supported", reason: "All stated." }), reviewAvailable: true });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", verdict: { verdict: "supported", exitStage: 7 } });
        expect(counts().review).toBe(1);
      });
    });

    it("asks for a retry when the review times out, so Supported is never saved without its second look", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, survey("The survey had 300 respondents across three regions."));
        const { llm } = fakeLlm({
          judge: () => supportedJudgment,
          review: () => { throw new LlmUnavailableError("The Gemini API request timed out."); },
          reviewAvailable: true,
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "retry", attempt: 1 });
        expect(await tx`select 1 from verdicts where claim_id = ${claimIds[0]!}`).toHaveLength(0);
      });
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

  describe("a quote that is in no passage gets one more ask (E21, 24 Nov 2026)", () => {
    const tidied = { ...supportedJudgment, quote: "We had 300 respondents across three regions of the country." };
    const claim = [{ text: "The survey had 300 respondents.", citation: "(Smith & Lee, 2021)" }];

    it("saves the verdict when the second quote is copied exactly, with the source's own text as the evidence", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, claim);
        const { llm, counts, prompts } = fakeLlm({ judge: (call) => (call === 1 ? tidied : supportedJudgment) });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({
          outcome: "done",
          quoteRetried: true,
          verdict: { verdict: "supported", quote: "The survey had 300 respondents across three regions", page: 4 },
        });
        expect(counts().judge).toBe(2);
        expect(prompts.filter((p) => p.includes("<previous_quote>"))).toHaveLength(1);
        expect(prompts.find((p) => p.includes("<previous_quote>"))).toContain("We had 300 respondents across three regions of the country.");
      });
    });

    it("still abstains, with no quote stored, when the second quote is also not in the source (hard rule 1)", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, claim);
        const { llm, counts } = fakeLlm({ judge: () => tidied });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", quoteRetried: true, verdict: { verdict: "cant_tell", quote: null, page: null } });
        expect(counts().judge).toBe(2); // one retry, never more
        const [row] = await tx`select quote, chunk_id from verdicts where claim_id = ${claimIds[0]!}`;
        expect(row).toMatchObject({ quote: null, chunk_id: null });
      });
    });

    it("keeps the abstain when the second ask itself fails", async () => {
      await inTx(async (tx) => {
        const { sessionId, claimIds } = await seed(tx, claim);
        const { llm } = fakeLlm({
          judge: (call) => {
            if (call === 1) return tidied;
            throw new LlmUnavailableError("The Gemini API request failed (HTTP 503).");
          },
        });
        const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
        expect(result).toMatchObject({ outcome: "done", quoteRetried: true, verdict: { verdict: "cant_tell", quote: null } });
      });
    });

    it("does not ask again for a missing or too short quote, or when the quote verified", async () => {
      await inTx(async (tx) => {
        for (const quote of [null, "The survey", supportedJudgment.quote]) {
          const { sessionId, claimIds } = await seed(tx, claim);
          const { llm, counts } = fakeLlm({ judge: () => ({ ...supportedJudgment, quote }) });
          const result = await checkClaim(tx, { llm, resolve: async () => found(TITLE) }, { sessionId, claimId: claimIds[0]! });
          expect(result.outcome).toBe("done");
          expect(result).not.toHaveProperty("quoteRetried");
          expect(counts().judge).toBe(1);
        }
      });
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
      expect(second.counts()).toEqual({ judge: 0, fix: 0, embed: 0, review: 0 });
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
