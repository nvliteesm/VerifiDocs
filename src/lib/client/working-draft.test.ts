import { describe, expect, it } from "vitest";
import type { ClaimView, Verdict } from "./types";
import { buildWorkingDraft, claimLabels, fitFix, groupOf, numberChange, openIssues, resolvedText, stepIssue } from "./working-draft";

let n = 0;
function claim(text: string, verdict: Verdict | null = "contradicted", extra: Partial<ClaimView> = {}): ClaimView {
  n += 1;
  return {
    id: `c${n}`,
    position: n,
    text,
    citation: null,
    citationInherited: false,
    section: null,
    need: "must",
    status: "done",
    verdict,
    quote: null,
    page: null,
    reason: null,
    exitStage: null,
    fixSuggestion: null,
    ...extra,
  };
}

describe("buildWorkingDraft with the draft text", () => {
  it("cuts the text at each claim sentence and keeps every other character", () => {
    const a = claim("Subsidies dropped by 18% in 2023.");
    const b = claim("Inflation was 3.2%.");
    const draft = `Intro line.\n\n${a.text} Then ${b.text}\n\nEnd.`;
    const working = buildWorkingDraft(draft, [b, a]);
    expect(working.unplaced).toEqual([]);
    expect(working.segments.map((s) => (s.kind === "claim" ? `[${s.label}]` : s.kind === "text" ? s.text : ""))).toEqual([
      "Intro line.\n\n",
      "[C-1]",
      " Then ",
      "[C-2]",
      "\n\nEnd.",
    ]);
    expect(resolvedText(working, {})).toBe(draft);
  });

  it("finds a sentence the draft wraps over lines, and keeps the draft's own spacing", () => {
    const a = claim("Subsidies dropped by 18%.");
    const working = buildWorkingDraft("Subsidies dropped\nby 18%.", [a]);
    const seg = working.segments[0];
    expect(seg?.kind === "claim" && seg.text).toBe("Subsidies dropped\nby 18%.");
  });

  it("matches the same sentence twice in order, not the first one again", () => {
    const a = claim("It rose.");
    const b = claim("It rose.");
    const working = buildWorkingDraft("It rose. And later: It rose.", [a, b]);
    expect(working.segments.filter((s) => s.kind === "claim")).toHaveLength(2);
    expect(working.unplaced).toEqual([]);
  });

  it("sets aside a claim whose sentence is not in the text, instead of dropping it", () => {
    const a = claim("Not in the draft at all.");
    const working = buildWorkingDraft("Something else entirely.", [a]);
    expect(working.unplaced).toEqual([a]);
    expect(resolvedText(working, {})).toBe("Something else entirely.");
  });

  it("swaps in an applied fix, and an undo is just removing it", () => {
    const a = claim("Subsidies dropped by 18%.", "contradicted", { fixSuggestion: "Subsidies dropped by 8%." });
    const working = buildWorkingDraft("Start. Subsidies dropped by 18%. End.", [a]);
    expect(resolvedText(working, { [a.id]: a.fixSuggestion! })).toBe("Start. Subsidies dropped by 8%. End.");
    expect(resolvedText(working, {})).toBe("Start. Subsidies dropped by 18%. End.");
  });
});

describe("buildWorkingDraft without the draft text", () => {
  it("rebuilds the draft from the checked sentences, in order, under their headings", () => {
    const a = claim("First.", "supported", { section: "Intro" });
    const b = claim("Second.", "contradicted", { section: "Intro" });
    const c = claim("Third.", "supported", { section: "Results" });
    const working = buildWorkingDraft(null, [c, a, b]);
    expect(working.segments.map((s) => s.kind)).toEqual(["heading", "claim", "text", "claim", "heading", "claim"]);
    expect(resolvedText(working, {})).toBe("Intro\nFirst. Second.\nResults\nThird.");
  });
});

describe("labels, groups and steps", () => {
  it("numbers claims by their place in the draft", () => {
    const a = claim("A.");
    const b = claim("B.");
    expect(claimLabels([b, a]).get(a.id)).toBe("C-1");
    expect(claimLabels([b, a]).get(b.id)).toBe("C-2");
  });

  it("puts each verdict in one filter", () => {
    expect(groupOf({ verdict: null })).toBe("waiting");
    expect(groupOf({ verdict: "supported" })).toBe("ok");
    expect(groupOf({ verdict: "no_citation_given" })).toBe("source");
    expect(groupOf({ verdict: "cant_check" })).toBe("source");
    expect(groupOf({ verdict: "contradicted" })).toBe("fix");
    expect(groupOf({ verdict: "partial" })).toBe("fix");
    expect(groupOf({ verdict: "reference_not_found" })).toBe("fix");
  });

  it("walks the open issues in draft order, wraps round, and skips resolved ones", () => {
    const a = claim("A.");
    const b = claim("B.");
    const c = claim("C.");
    const fixList = [c.id, a.id, b.id]; // ranked by severity, not by position
    const issues = openIssues([a, b, c], fixList, new Set([b.id]));
    expect(issues.map((x) => x.id)).toEqual([a.id, c.id]);
    expect(stepIssue(issues, null, 1)?.id).toBe(a.id);
    expect(stepIssue(issues, null, -1)?.id).toBe(c.id);
    expect(stepIssue(issues, a.id, 1)?.id).toBe(c.id);
    expect(stepIssue(issues, c.id, 1)?.id).toBe(a.id);
    expect(stepIssue(issues, a.id, -1)?.id).toBe(c.id);
    expect(stepIssue([], null, 1)).toBeNull();
  });

  it("carries on from where a resolved claim sat, instead of jumping back to the start", () => {
    const a = claim("A.");
    const b = claim("B.");
    const c = claim("C.");
    const open = [a, c]; // b was just applied
    expect(stepIssue(open, b.id, 1, b.position)?.id).toBe(c.id);
    expect(stepIssue(open, b.id, -1, b.position)?.id).toBe(a.id);
    expect(stepIssue([a], b.id, 1, b.position)?.id).toBe(a.id); // nothing after: wraps
  });

  it("leaves a general statement with no citation out of the issues", () => {
    const a = claim("A.", "no_citation_given", { need: "should" });
    expect(openIssues([a], [a.id], new Set())).toEqual([]);
  });
});

describe("numberChange", () => {
  it("names the one number that changes", () => {
    expect(numberChange("Subsidies dropped by 18% in 2023.", "Subsidies dropped by 8% in 2023.")).toEqual({ from: "18%", to: "8%" });
  });
  it("gives nothing when several numbers change or none does", () => {
    expect(numberChange("Up 4 and down 5.", "Up 6 and down 7.")).toBeNull();
    expect(numberChange("Same 4.", "Still 4.")).toBeNull();
  });
});

describe("fitFix", () => {
  it("drops the suggestion's closing stop when the sentence it replaces stops before its own", () => {
    expect(fitFix("Food prices fell during the same year", "Food prices rose by 7.1 percent in 2023.")).toBe("Food prices rose by 7.1 percent in 2023");
  });
  it("keeps closing quotes and brackets", () => {
    expect(fitFix("It was called a success", 'It was called a "success."')).toBe('It was called a "success"');
  });
  it("leaves the suggestion alone when the original ends with a stop, or the suggestion has none", () => {
    expect(fitFix("Prices fell.", "Prices rose.")).toBe("Prices rose.");
    expect(fitFix("Prices fell", "Prices rose")).toBe("Prices rose");
  });
});
