import { describe, expect, it } from "vitest";
import { FIX_LIST_ORDER, rankFixList } from "./fix-list";
import { VERDICTS, type Verdict } from "./pipeline/types";

const claim = (position: number, verdict: Verdict | null) => ({ position, verdict });

describe("rankFixList", () => {
  it("orders by severity as in docs/verdicts.md", () => {
    const shuffled = [
      claim(1, "cant_check"),
      claim(2, "partial"),
      claim(3, "contradicted"),
      claim(4, "cant_tell"),
      claim(5, "not_in_sources"),
      claim(6, "no_citation_given"),
      claim(7, "reference_not_found"),
    ];
    expect(rankFixList(shuffled).map((c) => c.verdict)).toEqual([
      "contradicted", "reference_not_found", "not_in_sources", "partial", "no_citation_given", "cant_tell", "cant_check",
    ]);
  });

  it("keeps draft order within the same severity", () => {
    const ranked = rankFixList([claim(9, "partial"), claim(2, "partial"), claim(5, "partial")]);
    expect(ranked.map((c) => c.position)).toEqual([2, 5, 9]);
  });

  it("leaves out Supported claims and claims with no verdict yet", () => {
    const ranked = rankFixList([claim(1, "supported"), claim(2, null), claim(3, "partial")]);
    expect(ranked).toEqual([claim(3, "partial")]);
  });

  it("covers every verdict except Supported, and does not change its input", () => {
    expect([...FIX_LIST_ORDER].sort()).toEqual(VERDICTS.filter((v) => v !== "supported").sort());
    const input = [claim(2, "partial"), claim(1, "contradicted")];
    rankFixList(input);
    expect(input.map((c) => c.position)).toEqual([2, 1]);
  });

  it("keeps extra fields on each item", () => {
    const [first] = rankFixList([{ position: 1, verdict: "partial" as Verdict, id: "abc" }]);
    expect(first!.id).toBe("abc");
  });
});
