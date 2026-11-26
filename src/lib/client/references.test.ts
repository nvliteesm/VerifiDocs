import { describe, expect, it } from "vitest";
import { entriesToWorkOn, summarizeReferences } from "./references";
import type { ReferenceSource, ReferenceSourceState } from "./types";

const ref = (sourceState: ReferenceSourceState, documentId: string | null = null): ReferenceSource => ({
  id: `${sourceState}-${Math.random()}`, position: 1, text: "x", title: "x", byline: "", refType: "journal", sourceState, documentId, candidate: null,
});

describe("summarizeReferences", () => {
  it("puts every reference in exactly one bucket, so the numbers add up", () => {
    const refs = [ref("retrieved", "d1"), ref("uploaded", "d2"), ref("possible"), ref("not_retrieved"), ref("matched_no_file"), ref("pending"), ref("matched")];
    expect(summarizeReferences(refs)).toEqual({ total: 7, retrieved: 2, possible: 1, missing: 2, pending: 2 });
  });

  it("is all zero for no references", () => {
    expect(summarizeReferences([])).toEqual({ total: 0, retrieved: 0, possible: 0, missing: 0, pending: 0 });
  });
});

describe("entriesToWorkOn", () => {
  it("returns what is not looked up yet or is matched and waiting for its PDF, and nothing that already has a file", () => {
    const work = [ref("pending"), ref("matched")];
    const rest = [ref("retrieved", "d"), ref("uploaded", "d"), ref("possible"), ref("not_retrieved"), ref("matched_no_file"), ref("pending", "already-linked")];
    expect(entriesToWorkOn([...work, ...rest])).toEqual(work);
  });
});
