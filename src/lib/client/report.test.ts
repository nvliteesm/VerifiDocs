import { describe, expect, it } from "vitest";
import { buildReport } from "./report";
import type { ClaimView, Verdict } from "./types";

const claim = (id: string, position: number, verdict: Verdict | null, over: Partial<ClaimView> = {}): ClaimView => ({
  id,
  position,
  text: `Claim number ${position}.`,
  citation: null,
  citationInherited: false,
  section: null,
  need: "must",
  status: verdict ? "done" : "pending",
  verdict,
  quote: null,
  page: null,
  reason: null,
  exitStage: null,
  fixSuggestion: null,
  ...over,
});

describe("buildReport", () => {
  const claims = [
    claim("a", 1, "supported", { page: 3 }),
    claim("b", 2, "partial", {
      citation: "(Smith, 2021)",
      quote: "Pain fell in 70% of patients.",
      page: 8,
      reason: "Overstated.",
      fixSuggestion: "Pain fell in 70% of patients (Smith, 2021).",
    }),
    claim("c", 3, "contradicted", { quote: "The survey had 300 respondents.", page: 2 }),
    claim("d", 4, "no_citation_given", { reason: "The claim has no citation." }),
  ];
  const report = buildReport(claims, ["c", "b", "d"]);

  it("starts with a one-line summary", () => {
    expect(report.split("\n")[0]).toBe("VerifiDocs report");
    expect(report).toContain("4 claims checked: 3 need attention, 1 supported.");
  });

  it("lists the claims that need attention in fix-list order, each with its label, evidence and rewrite", () => {
    const first = report.indexOf("1. [Contradicted]");
    const second = report.indexOf("2. [Partly supported]");
    const third = report.indexOf("3. [No citation]");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(report).toContain('Your source says (page 8): "Pain fell in 70% of patients."');
    expect(report).toContain("Citation: (Smith, 2021)");
    expect(report).toContain("Suggested rewrite: Pain fell in 70% of patients (Smith, 2021).");
    expect(report).toContain("Why: Overstated.");
  });

  it("lists supported claims after, with their page", () => {
    expect(report.indexOf("SUPPORTED")).toBeGreaterThan(report.indexOf("NEEDS ATTENTION"));
    expect(report).toContain("- Claim number 1. (page 3)");
  });

  it("leaves out lines it has no data for, and never prints 'undefined' or 'null'", () => {
    expect(report).not.toMatch(/undefined|null/);
    const plain = buildReport([claim("x", 1, "cant_tell")], ["x"]);
    expect(plain).not.toContain("Citation:");
    expect(plain).not.toContain("Your source says");
    expect(plain).not.toContain("Suggested rewrite");
  });

  it("handles singular wording, no problems, and claims not checked yet", () => {
    expect(buildReport([claim("a", 1, "partial")], ["a"])).toContain("1 claim checked: 1 needs attention, 0 supported.");
    const clean = buildReport([claim("a", 1, "supported")], []);
    expect(clean).toContain("0 need attention, 1 supported.");
    expect(clean).not.toContain("NEEDS ATTENTION");
    expect(buildReport([claim("a", 1, "supported"), claim("b", 2, null)], [])).toContain("1 claim not checked yet.");
  });

  it("ignores a fix-list id that is not a claim, and handles no claims at all", () => {
    expect(buildReport([claim("a", 1, "partial")], ["zzz", "a"])).toContain("1. [Partly supported]");
    expect(buildReport([], [])).toContain("0 claims checked");
  });
});
