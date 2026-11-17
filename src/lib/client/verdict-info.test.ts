import { describe, expect, it } from "vitest";
import { VERDICTS } from "../pipeline/types";
import { FIX_LIST_ORDER } from "../fix-list";
import { SUMMARY_ORDER, VERDICT_INFO, attentionCount, needsAttention } from "./verdict-info";

describe("VERDICT_INFO", () => {
  it("describes every one of the eight verdicts, with a label, symbol and meaning", () => {
    expect(Object.keys(VERDICT_INFO).sort()).toEqual([...VERDICTS].sort());
    for (const verdict of VERDICTS) {
      const info = VERDICT_INFO[verdict];
      expect(info.label.length, verdict).toBeGreaterThan(2);
      expect(info.symbol.length, verdict).toBeGreaterThan(0);
      expect(info.meaning.length, verdict).toBeGreaterThan(15);
    }
  });

  it("never relies on colour alone: labels and symbols are unique", () => {
    const labels = Object.values(VERDICT_INFO).map((i) => i.label);
    const symbols = Object.values(VERDICT_INFO).map((i) => i.symbol);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("gives advice for everything that needs attention, and none for Supported", () => {
    for (const verdict of VERDICTS) {
      if (verdict === "supported") expect(VERDICT_INFO[verdict].advice).toBe("");
      else expect(VERDICT_INFO[verdict].advice.length, verdict).toBeGreaterThan(10);
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
