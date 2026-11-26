import { describe, expect, it } from "vitest";
import { groupFindings, plainCitation, priorityOf, sectionsOf, severityOf, startHere } from "./findings";
import type { ClaimView, Verdict } from "./types";

let n = 0;
function claim(verdict: Verdict | null, extra: Partial<ClaimView> = {}): ClaimView {
  n += 1;
  return {
    id: `c${n}`, position: n, text: `Sentence ${n}.`, citation: "(Smith, 2020)", citationInherited: false, section: null, need: "must", status: verdict ? "done" : "pending",
    verdict, quote: null, page: null, reason: null, exitStage: null, fixSuggestion: null, ...extra,
  } as ClaimView;
}

describe("severityOf", () => {
  it("makes only a contradicted claim a high severity, and a missing source low", () => {
    expect(severityOf("contradicted")).toBe("high");
    for (const verdict of ["partial", "not_in_sources", "reference_not_found", "cant_tell"] as const) expect(severityOf(verdict), verdict).toBe("medium");
    for (const verdict of ["no_citation_given", "cant_check", "supported"] as const) expect(severityOf(verdict), verdict).toBe("low");
  });
});

describe("groupFindings", () => {
  it("turns the same unlisted reference cited in many places into one group with every place, in draft order", () => {
    const claims = [claim("reference_not_found", { citation: "(Darmono, 2016)" }), claim("supported"), claim("reference_not_found", { citation: "Darmono, 2016" }), claim("reference_not_found", { citation: "(Darmono, 2016)" }), claim("reference_not_found", { citation: "(Rahman, 2016)" })];
    const groups = groupFindings(claims);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ verdict: "reference_not_found", citation: "Darmono, 2016" });
    expect(groups[0]!.claims.map((c) => c.position)).toEqual([claims[0]!.position, claims[2]!.position, claims[3]!.position]);
    expect(groups[1]!.claims).toHaveLength(1);
  });

  it("keeps every content finding on its own, even with the same citation", () => {
    const groups = groupFindings([claim("contradicted"), claim("contradicted"), claim("partial")]);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.citation === null)).toBe(true);
  });

  it("leaves out what is not a finding: supported claims, claims waiting for a file, general statements, and handled ones", () => {
    const handled = claim("contradicted");
    const claims = [claim("supported"), claim("cant_check"), claim(null), claim("no_citation_given", { need: "should" }), handled, claim("no_citation_given", { need: "must" })];
    const groups = groupFindings(claims, new Set([handled.id]));
    expect(groups.map((g) => g.verdict)).toEqual(["no_citation_given"]);
  });

  it("does not group claims with no citation, and does not merge different verdicts of one citation", () => {
    const groups = groupFindings([claim("no_citation_given", { citation: null }), claim("no_citation_given", { citation: null }), claim("reference_not_found", { citation: "(A, 2020)" }), claim("cant_check", { citation: "(A, 2020)" })]);
    expect(groups).toHaveLength(3); // two uncited, one finding for the citation (cant_check is not a finding)
  });
});

describe("startHere", () => {
  it("puts a confirmed content problem before citation fixes, and a citation missing in many places before one missing once", () => {
    const many = [1, 2, 3, 4, 5, 6].map(() => claim("reference_not_found", { citation: "(Darmono, 2016)" }));
    const claims = [claim("reference_not_found", { citation: "(Once, 2019)" }), ...many, claim("contradicted", { quote: "q", fixSuggestion: "fix" }), claim("cant_tell")];
    const top = startHere(groupFindings(claims));
    expect(top[0]!.verdict).toBe("contradicted");
    expect(top[1]).toMatchObject({ verdict: "reference_not_found", citation: "Darmono, 2016" });
    expect(top.at(-1)!.verdict).toBe("cant_tell");
  });

  it("returns at most five, however many findings there are, and fewer when there are fewer", () => {
    const many = Array.from({ length: 40 }, () => claim("no_citation_given", { need: "must", citation: null }));
    expect(startHere(groupFindings(many))).toHaveLength(5);
    expect(startHere(groupFindings([claim("partial")]))).toHaveLength(1);
    expect(startHere([])).toEqual([]);
  });

  it("breaks a tie by the earlier place in the draft", () => {
    const a = claim("partial");
    const b = claim("partial");
    expect(startHere(groupFindings([b, a])).map((g) => g.claims[0]!.id)).toEqual([a.id, b.id]);
  });

  it("scores a finding with a source quote and a ready fix above the same finding without", () => {
    const [plain] = groupFindings([claim("partial")]);
    const [backed] = groupFindings([claim("partial", { quote: "q", fixSuggestion: "fix" })]);
    expect(priorityOf(backed!)).toBeGreaterThan(priorityOf(plain!));
  });
});

describe("plainCitation and sectionsOf", () => {
  it("drops the brackets around a citation", () => {
    expect(plainCitation("(Darmono, 2016)")).toBe("Darmono, 2016");
    expect(plainCitation("[3]")).toBe("3");
  });

  it("lists the sections that have claims, in draft order, without repeats", () => {
    expect(sectionsOf([claim("partial", { section: "2. Metode" }), claim("partial", { section: "1. Latar Belakang" }), claim("partial", { section: "2. Metode" }), claim("partial", { section: null })])).toEqual(["2. Metode", "1. Latar Belakang"]);
  });
});
