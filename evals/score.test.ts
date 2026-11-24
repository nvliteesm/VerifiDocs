import { describe, expect, it } from "vitest";
import { scoreEval, type EvalClaim, type Outcome } from "./score";

const claim = (id: string, expected: string, over: Partial<EvalClaim> = {}): EvalClaim => ({
  id,
  language: "en",
  claim: `Claim ${id}`,
  citation: "(Smith, 2020)",
  expected_verdict: expected,
  also_acceptable: [],
  expected_quote: null,
  expected_page: null,
  split: "dev",
  seen_in_tuning: false,
  status: "approved",
  notes: "",
  ...over,
});
const out = (id: string, run: number, verdict: string, latencyMs = 1000): Outcome => ({ id, run, verdict, latencyMs, retries: 0 });

describe("scoreEval", () => {
  const claims = [
    claim("A", "supported"),
    claim("B", "contradicted", { also_acceptable: ["partial"], language: "id" }),
    claim("C", "not_in_sources", { split: "held_out" }),
    claim("D", "partial"),
  ];

  it("scores strict and lenient correctness over every run", () => {
    const report = scoreEval(claims, [
      out("A", 1, "supported"), out("B", 1, "partial"), out("C", 1, "not_in_sources"), out("D", 1, "partial"),
      out("A", 2, "supported"), out("B", 2, "contradicted"), out("C", 2, "not_in_sources"), out("D", 2, "supported"),
    ]);
    // Strict: A 2, B 1, C 2, D 1 of 8. Lenient adds B's "partial" (also acceptable): 7 of 8.
    expect(report.strict).toBeCloseTo(6 / 8);
    expect(report.lenient).toBeCloseTo(7 / 8);
  });

  it("reports checks that needed a retry and checks whose second look failed", () => {
    const report = scoreEval(claims, [
      { ...out("A", 1, "supported"), retries: 2 },
      { ...out("B", 1, "partial"), reviewSkipped: true },
      { ...out("B", 2, "partial"), reviewSkipped: true },
      { ...out("D", 1, "partial"), reviewSkipped: false },
    ]);
    expect(report.retried).toBe(1);
    expect(report.reviewSkipped).toEqual({ count: 2, ids: ["B"] });
    expect(scoreEval(claims, [out("A", 1, "supported")])).toMatchObject({ retried: 0, reviewSkipped: { count: 0, ids: [] } });
  });

  it("counts a claim labelled unsupported but called Supported as a miss, against the 5% bar", () => {
    const report = scoreEval(claims, [out("A", 1, "supported"), out("B", 1, "contradicted"), out("C", 1, "supported"), out("D", 1, "partial")]);
    expect(report.missed).toEqual({ count: 1, of: 3, rate: 1 / 3, ids: ["C"] });
    expect(report.meetsBar).toBe(false);
  });

  it("meets the bar only at 90% strict or better with 5% misses or fewer", () => {
    const many = Array.from({ length: 20 }, (_, i) => claim(`S${i}`, "supported"));
    const allRight = scoreEval(many, many.map((c) => out(c.id, 1, "supported")));
    expect(allRight.meetsBar).toBe(true);
    const threeWrong = scoreEval(many, many.map((c, i) => out(c.id, 1, i < 3 ? "partial" : "supported")));
    expect(threeWrong.strict).toBeCloseTo(17 / 20);
    expect(threeWrong.meetsBar).toBe(false);
  });

  it("breaks results down by expected verdict, split and language", () => {
    const report = scoreEval(claims, [out("A", 1, "supported"), out("B", 1, "partial"), out("C", 1, "not_in_sources"), out("D", 1, "supported")]);
    expect(report.byExpected.contradicted).toEqual({ n: 1, strict: 0, got: { partial: 1 } });
    expect(report.byExpected.partial).toEqual({ n: 1, strict: 0, got: { supported: 1 } });
    expect(report.bySplit.held_out).toEqual({ n: 1, strict: 1, lenient: 1 });
    expect(report.byLanguage.id).toEqual({ n: 1, strict: 0, lenient: 1 });
  });

  it("lists the claims whose verdict changed between runs", () => {
    const report = scoreEval(claims, [
      out("A", 1, "supported"), out("A", 2, "partial"), out("B", 1, "contradicted"), out("B", 2, "contradicted"),
      out("C", 1, "not_in_sources"), out("C", 2, "not_in_sources"), out("D", 1, "partial"), out("D", 2, "partial"),
    ]);
    expect(report.unstable).toEqual(["A"]);
  });

  it("scores only approved labels, and says how many were left out (hard rule 10)", () => {
    const mixed = [claim("A", "supported"), claim("P", "supported", { status: "proposed" })];
    const report = scoreEval(mixed, [out("A", 1, "supported"), out("P", 1, "partial")]);
    expect(report.claims).toBe(1);
    expect(report.notApproved).toBe(1);
    expect(report.strict).toBe(1);
  });

  it("scores proposed labels only when asked, and marks the report as a preview", () => {
    const mixed = [claim("A", "supported"), claim("P", "supported", { status: "proposed" })];
    const report = scoreEval(mixed, [out("A", 1, "supported"), out("P", 1, "partial")], { includeProposed: true });
    expect(report).toMatchObject({ claims: 2, preview: true, strict: 0.5 });
  });

  it("counts an error as wrong, and reports latency percentiles", () => {
    const report = scoreEval([claim("A", "supported"), claim("B", "supported")], [
      { id: "A", run: 1, verdict: "error", latencyMs: 4000, retries: 6 },
      out("B", 1, "supported", 2000),
    ]);
    expect(report.strict).toBe(0.5);
    expect(report.errors).toBe(1);
    expect(report.latency).toMatchObject({ p50: 2000, max: 4000 });
  });
});
