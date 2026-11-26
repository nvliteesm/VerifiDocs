import { describe, expect, it } from "vitest";
import { VERDICTS } from "../pipeline/types";
import { FIX_LIST_ORDER } from "../fix-list";
import { translatorFor } from "../i18n";
import { SUMMARY_ORDER, VERDICT_INFO, attentionCount, coverageOf, needsAttention, verdictAdvice, verdictLabel } from "./verdict-info";

const LANGUAGES = [
  ["English", translatorFor("en")],
  ["Bahasa Indonesia", translatorFor("id")],
] as const;

describe("VERDICT_INFO", () => {
  it("describes every one of the eight verdicts, with a label and a symbol", () => {
    expect(Object.keys(VERDICT_INFO).sort()).toEqual([...VERDICTS].sort());
    for (const verdict of VERDICTS) {
      const info = VERDICT_INFO[verdict];
      expect(info.symbol.length, verdict).toBeGreaterThan(0);
      for (const [language, t] of LANGUAGES) expect(verdictLabel(t, verdict).length, `${language} ${verdict}`).toBeGreaterThan(2);
    }
  });

  it("never relies on colour alone: labels and symbols are unique", () => {
    const symbols = Object.values(VERDICT_INFO).map((i) => i.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const [language, t] of LANGUAGES) {
      const labels = VERDICTS.map((verdict) => verdictLabel(t, verdict));
      expect(new Set(labels).size, language).toBe(labels.length);
    }
  });

  it("gives advice for everything that needs attention, and none for Supported", () => {
    for (const verdict of VERDICTS) {
      for (const [language, t] of LANGUAGES) {
        const advice = verdictAdvice(t, verdict);
        if (verdict === "supported") expect(advice, language).toBe("");
        else expect(advice.length, `${language} ${verdict}`).toBeGreaterThan(10);
        expect(advice.length, `${language} ${verdict}`).toBeLessThanOrEqual(90); // short on purpose
      }
    }
  });

  it("does not use the word 'AI' or detection language (positioning: a self-check)", () => {
    const all = JSON.stringify(VERDICT_INFO);
    expect(all).not.toMatch(/\bAI\b|detect|plagiar/i);
  });
});

describe("needsAttention and attentionCount", () => {
  it("treats everything except Supported and 'no verdict yet' as needing attention", () => {
    expect(needsAttention(null)).toBe(false);
    expect(needsAttention("supported")).toBe(false);
    for (const verdict of VERDICTS.filter((v) => v !== "supported")) expect(needsAttention(verdict)).toBe(true);
  });

  it("counts claims that need attention", () => {
    expect(attentionCount({ supported: 5, partial: 2, cant_tell: 1 })).toBe(3);
    expect(attentionCount({})).toBe(0);
    expect(attentionCount({ supported: 4 })).toBe(0);
  });
});

describe("SUMMARY_ORDER", () => {
  it("lists every verdict once, serious ones in fix-list order, and Supported last", () => {
    expect([...SUMMARY_ORDER].sort()).toEqual([...VERDICTS].sort());
    expect(SUMMARY_ORDER.slice(0, -1)).toEqual([...FIX_LIST_ORDER]);
    expect(SUMMARY_ORDER.at(-1)).toBe("supported");
  });
});

describe("coverageOf", () => {
  const claim = (verdict: Parameters<typeof coverageOf>[0][number]["verdict"], need?: "must" | "should") => ({ verdict, need });

  it("puts every claim in exactly one bucket, so the counts add up", () => {
    const claims = [
      claim("supported"), claim("supported"),
      claim("partial"), claim("contradicted"), claim("not_in_sources"), claim("cant_tell"),
      claim("reference_not_found"), claim("no_citation_given", "must"),
      claim("cant_check"), claim("cant_check"), claim(null),
      claim("no_citation_given", "should"),
    ];
    const coverage = coverageOf(claims, false);
    expect(coverage).toMatchObject({ total: 12, supported: 2, findings: 4, citation: 2, awaiting: 3, general: 1, checking: 0, verified: 6 });
    expect(coverage.supported + coverage.findings + coverage.citation + coverage.awaiting + coverage.general + coverage.checking).toBe(coverage.total);
  });

  it("says nothing could be verified when only sources are missing, and never counts those claims as wrong", () => {
    const coverage = coverageOf([claim("cant_check"), claim("cant_check"), claim("reference_not_found"), claim("no_citation_given", "must")], false);
    expect(coverage).toMatchObject({ none: true, incomplete: true, verified: 0, findings: 0, awaiting: 2 });
  });

  it("is incomplete but not empty once some claims were read against a source", () => {
    expect(coverageOf([claim("supported"), claim("cant_check")], false)).toMatchObject({ none: false, incomplete: true, verified: 1 });
  });

  it("is complete when nothing waits for a source, and counts unanswered claims as checking while the check runs", () => {
    expect(coverageOf([claim("supported"), claim("contradicted")], false)).toMatchObject({ incomplete: false, none: false });
    expect(coverageOf([claim("supported"), claim(null)], true)).toMatchObject({ checking: 1, awaiting: 0, none: false });
  });
});
