import { describe, expect, it } from "vitest";
import type { CheckedVerdict, ClaimView, RunResponse, Verdict } from "./types";
import { checkedProgress, countVerdicts, initialState, reduce, type VerifierState } from "./verifier-state";

const claim = (id: string, position: number, verdict: Verdict | null = null): ClaimView => ({
  id,
  position,
  text: `Claim ${position}`,
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
});

const runResponse = (claims: ClaimView[], status: RunResponse["run"]["status"] = "checking"): RunResponse => ({
  run: { id: "run-1", status, unitCount: 2, unitsExtracted: 2, claimCount: claims.length, createdAt: "t", completedAt: null },
  progress: { checked: 0, total: claims.length },
  counts: {},
  fixList: [],
  failedParts: [],
  claims,
  references: [{ position: 1, text: "Ref one", resolution: "found", resolvedTitle: "Title", yearMismatch: false }],
});

const verdictFor = (claimId: string, verdict: Verdict, over: Partial<CheckedVerdict> = {}): CheckedVerdict => ({
  claimId,
  verdict,
  quote: null,
  page: null,
  reason: "because",
  exitStage: 7,
  fixSuggestion: null,
  ...over,
});

const apply = (state: VerifierState, ...events: Parameters<typeof reduce>[1][]) => events.reduce(reduce, state);

describe("reduce: progress", () => {
  it("tracks phase and message, and clears an earlier error", () => {
    const failed = reduce(initialState, { type: "failed", message: "Nope." });
    expect(failed).toMatchObject({ phase: "error", error: "Nope." });
    const retried = reduce(failed, { type: "phase", phase: "starting", message: "Reading your draft..." });
    expect(retried).toMatchObject({ phase: "starting", message: "Reading your draft...", error: null });
  });

  it("starting a run clears the previous results", () => {
    const before = apply(initialState, { type: "loaded", run: runResponse([claim("a", 1, "partial")]) });
    expect(before.claims).toHaveLength(1);
    const next = reduce(before, { type: "run", runId: "run-2", unitCount: 3 });
    expect(next).toMatchObject({ runId: "run-2", unitCount: 3, claims: [], counts: {}, fixList: [], references: [] });
  });

  it("tracks extraction progress", () => {
    const state = apply(initialState, { type: "run", runId: "r", unitCount: 3 }, { type: "extracted", unitsExtracted: 2 });
    expect(state).toMatchObject({ unitCount: 3, unitsExtracted: 2 });
  });

  it("reset returns to the start", () => {
    expect(apply(initialState, { type: "run", runId: "r", unitCount: 1 }, { type: "reset" })).toEqual(initialState);
  });
});

describe("reduce: claims, counts and the fix list", () => {
  it("loading a run sets the claims, references and run status, and derives counts and the ranked fix list", () => {
    const state = reduce(initialState, {
      type: "loaded",
      run: runResponse([claim("a", 1, "supported"), claim("b", 2, "partial"), claim("c", 3, "contradicted"), claim("d", 4)]),
    });
    expect(state.runId).toBe("run-1");
    expect(state.runStatus).toBe("checking");
    expect(state.counts).toEqual({ supported: 1, partial: 1, contradicted: 1 });
    expect(state.fixList).toEqual(["c", "b"]);
    expect(state.references).toHaveLength(1);
  });

  it("derives the fix list itself, ignoring the server's list, so it always matches the claims shown", () => {
    const run = runResponse([claim("a", 1, "partial"), claim("b", 2, "contradicted")]);
    run.fixList = ["a", "b"]; // wrong order on purpose
    expect(reduce(initialState, { type: "loaded", run }).fixList).toEqual(["b", "a"]);
  });

  it("a verdict arriving updates that claim, the counts and the fix list", () => {
    let state = reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1), claim("b", 2)]) });
    expect(checkedProgress(state)).toEqual({ checked: 0, total: 2 });

    state = reduce(state, {
      type: "claim",
      verdict: verdictFor("b", "partial", { quote: "A quote that counts", page: 4, fixSuggestion: "A better sentence." }),
    });
    expect(state.claims[1]).toMatchObject({ status: "done", verdict: "partial", quote: "A quote that counts", page: 4, fixSuggestion: "A better sentence." });
    expect(state.claims[0]!.verdict).toBeNull();
    expect(state.counts).toEqual({ partial: 1 });
    expect(state.fixList).toEqual(["b"]);
    expect(checkedProgress(state)).toEqual({ checked: 1, total: 2 });

    state = reduce(state, { type: "claim", verdict: verdictFor("a", "contradicted") });
    expect(state.fixList).toEqual(["a", "b"]);
  });

  it("keeps the year notes a verdict brings, and keeps none when it brings none", () => {
    let state = reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1), claim("b", 2)]) });
    state = reduce(state, { type: "claim", verdict: verdictFor("a", "supported", { yearNotes: [{ position: 9, cited: 2015, published: 2013 }] }) });
    state = reduce(state, { type: "claim", verdict: verdictFor("b", "supported") });
    expect(state.claims[0]!.yearNotes).toEqual([{ position: 9, cited: 2015, published: 2013 }]);
    expect(state.claims[1]!.yearNotes ?? []).toEqual([]);
  });

  it("ignores a verdict for a claim it does not know", () => {
    const state = reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1)]) });
    const after = reduce(state, { type: "claim", verdict: verdictFor("zzz", "supported") });
    expect(after.claims).toEqual(state.claims);
  });

  it("does not change the input state (pure)", () => {
    const state = reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1)]) });
    const frozen = JSON.stringify(state);
    reduce(state, { type: "claim", verdict: verdictFor("a", "supported") });
    reduce(state, { type: "claimError", id: "a", message: "x" });
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe("reduce: claim errors", () => {
  it("records a failed check, and clears it when the claim is retried or gets a verdict", () => {
    let state = reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1), claim("b", 2)]) });
    state = reduce(state, { type: "claimError", id: "a", message: "Could not check this claim." });
    state = reduce(state, { type: "claimError", id: "b", message: "Could not check this claim." });
    expect(Object.keys(state.claimErrors).sort()).toEqual(["a", "b"]);

    state = reduce(state, { type: "claimRetry", id: "a" });
    expect(Object.keys(state.claimErrors)).toEqual(["b"]);

    state = reduce(state, { type: "claim", verdict: verdictFor("b", "supported") });
    expect(state.claimErrors).toEqual({});
  });
});

describe("stopping a check", () => {
  const running = (phase: "starting" | "extracting" | "checking"): VerifierState =>
    reduce(reduce(initialState, { type: "loaded", run: runResponse([claim("a", 1, "supported"), claim("b", 2)]) }), {
      type: "phase",
      phase,
      message: "working",
    });

  it("ends a running check as done and stopped, keeping the verdicts it already has", () => {
    for (const phase of ["starting", "extracting", "checking"] as const) {
      const state = reduce(running(phase), { type: "stopped" });
      expect(state.phase).toBe("done");
      expect(state.stopped).toBe(true);
      expect(state.message).toBe("");
      expect(state.claims.map((c) => c.verdict)).toEqual(["supported", null]);
    }
  });

  it("ignores a Stop that arrives after the check has already ended, so a finished check never looks stopped", () => {
    const done = reduce(running("checking"), { type: "phase", phase: "done", message: "Done." });
    expect(reduce(done, { type: "stopped" })).toBe(done);
    const failed = reduce(running("checking"), { type: "failed", message: "boom" });
    expect(reduce(failed, { type: "stopped" })).toBe(failed);
    expect(reduce(initialState, { type: "stopped" })).toBe(initialState);
  });

  it("forgets the stop when a new check starts or the screen is reset", () => {
    const stopped = reduce(running("checking"), { type: "stopped" });
    expect(reduce(stopped, { type: "reset" }).stopped).toBe(false);
    expect(reduce(stopped, { type: "run", runId: "run-2", unitCount: 1 }).stopped).toBe(false);
  });
});

describe("countVerdicts", () => {
  it("counts only claims that have a verdict", () => {
    expect(countVerdicts([claim("a", 1, "partial"), claim("b", 2, "partial"), claim("c", 3)])).toEqual({ partial: 2 });
    expect(countVerdicts([])).toEqual({});
  });
});

describe("found sources", () => {
  it("puts the papers on the claim and marks it searched", () => {
    const state = reduce({ ...initialState, claims: [claim("a", 1), claim("b", 2)] }, {
      type: "sources",
      claimId: "b",
      sources: [],
    });
    expect(state.claims.map((c) => c.sourcesSearched)).toEqual([undefined, true]);
  });
});
