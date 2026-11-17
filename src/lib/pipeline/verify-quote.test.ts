import { describe, expect, it } from "vitest";
import type { JudgePassage, RawJudgment } from "./judge";
import { MIN_QUOTE_CHARS, verifyJudgment } from "./verify-quote";

const passages: JudgePassage[] = [
  { chunkId: "chunk-a", pageNumber: 4, content: "The survey had 300 respondents across three regions of the country." },
  {
    chunkId: "chunk-b",
    pageNumber: 9,
    content: "Most partici-\npants were adults aged 18 to 40. The ﬁnancial results were “mixed” overall.",
  },
];

const judgment = (over: Partial<RawJudgment>): RawJudgment => ({
  verdict: "supported",
  quote: "The survey had 300 respondents across three regions",
  page: 4,
  chunk_id: "P1",
  reason: "It says so.",
  ...over,
});

describe("verifyJudgment: a verified quote keeps its verdict", () => {
  it("keeps supported, partial and contradicted and stores the exact source text, page and chunk", () => {
    for (const verdict of ["supported", "partial", "contradicted"] as const) {
      expect(verifyJudgment(judgment({ verdict }), passages)).toEqual({
        verdict,
        quote: "The survey had 300 respondents across three regions",
        page: 4,
        chunkId: "chunk-a",
        reason: "It says so.",
      });
    }
  });

  it("matches despite line-break hyphenation, ligatures and curly quotes, and stores the source's own text", () => {
    const result = verifyJudgment(
      judgment({
        quote: 'Most participants were adults aged 18 to 40. The financial results were "mixed" overall.',
        page: 9,
        chunk_id: "P2",
      }),
      passages,
    );
    expect(result.verdict).toBe("supported");
    expect(result.chunkId).toBe("chunk-b");
    expect(result.quote).toBe('Most participants were adults aged 18 to 40. The financial results were "mixed" overall.');
  });

  it("uses the chunk's page, not the page the model reported", () => {
    expect(verifyJudgment(judgment({ page: 99 }), passages).page).toBe(4);
    expect(verifyJudgment(judgment({ page: null }), passages).page).toBe(4);
  });

  it("finds the quote in another passage when the model named the wrong one, and says so", () => {
    const result = verifyJudgment(judgment({ chunk_id: "P2" }), passages);
    expect(result).toMatchObject({ verdict: "supported", chunkId: "chunk-a", page: 4, reattributed: true });
  });

  it("copes with a missing or malformed passage label without calling it a reattribution", () => {
    for (const label of [null, "", "P7", "chunk-a", "p0"]) {
      const result = verifyJudgment(judgment({ chunk_id: label }), passages);
      expect(result).toMatchObject({ verdict: "supported", chunkId: "chunk-a" });
      expect(result.reattributed).toBeUndefined();
    }
  });
});

describe("verifyJudgment: a quote that does not verify becomes Can't tell (hard rule 1)", () => {
  const cantTell = (raw: RawJudgment) => {
    const result = verifyJudgment(raw, passages);
    expect(result).toMatchObject({ verdict: "cant_tell", quote: null, page: null, chunkId: null, downgradedFrom: raw.verdict });
    return result;
  };

  it("a quote that is not in any passage", () => {
    expect(cantTell(judgment({ quote: "The survey had 500 respondents across three regions" })).reason).toMatch(/could not be found/);
  });

  it("a paraphrase", () => {
    cantTell(judgment({ quote: "Three hundred people took part in the survey across regions" }));
  });

  it("a quote that differs only in case", () => {
    cantTell(judgment({ quote: "THE SURVEY HAD 300 RESPONDENTS ACROSS THREE REGIONS" }));
  });

  it("no quote at all, for each verdict that needs one", () => {
    for (const verdict of ["supported", "partial", "contradicted"] as const) {
      for (const quote of [null, "", "   "]) {
        expect(cantTell(judgment({ verdict, quote })).reason).toMatch(/no quote/);
      }
    }
  });

  it("a quote too short to count as evidence", () => {
    for (const quote of ["300 respondents", "The survey", "The survey had 300"]) {
      expect(cantTell(judgment({ quote })).reason).toMatch(/too short/);
    }
    expect(MIN_QUOTE_CHARS).toBeGreaterThan(10);
  });

  it("a quote that exists only in the claim, not in the passages", () => {
    cantTell(judgment({ quote: "The survey had 500 respondents across three regions" }));
  });

  it("never lets a Supported verdict through without a verified quote and page", () => {
    for (const quote of [null, "invented text that is not in the source at all"]) {
      const result = verifyJudgment(judgment({ verdict: "supported", quote }), passages);
      expect(result.verdict).not.toBe("supported");
    }
  });
});

describe("verifyJudgment: verdicts that carry no quote", () => {
  it("passes not_in_sources and cant_tell through and drops any quote the model sent", () => {
    for (const verdict of ["not_in_sources", "cant_tell"] as const) {
      const result = verifyJudgment(judgment({ verdict, quote: "some quote the model should not have sent" }), passages);
      expect(result).toEqual({ verdict, quote: null, page: null, chunkId: null, reason: "It says so." });
      expect(result.downgradedFrom).toBeUndefined();
    }
  });

  it("keeps the reason short and on one line", () => {
    const result = verifyJudgment(judgment({ verdict: "not_in_sources", reason: `line one\n\n${"x".repeat(800)}` }), passages);
    expect(result.reason).not.toContain("\n");
    expect(result.reason.length).toBeLessThanOrEqual(403);
  });
});
