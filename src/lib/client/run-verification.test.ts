import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import {
  CHECK_CONCURRENCY,
  oneClaimPerCitation,
  retryClaim,
  resumeVerification,
  runVerification,
  type VerifyDeps,
} from "./run-verification";
import type { CheckResponse, ClaimView, RunResponse, RunStatus, VerifyInput, Verdict } from "./types";
import { initialState, reduce, type VerifyEvent } from "./verifier-state";

const input: VerifyInput = { draft: { kind: "paste", text: "A draft with claims." }, references: "" };

const claim = (id: string, position: number, verdict: Verdict | null = null): ClaimView => ({
  id,
  position,
  text: `Claim ${position}`,
  citation: "(Smith, 2021)",
  status: verdict ? "done" : "pending",
  verdict,
  quote: null,
  page: null,
  reason: null,
  exitStage: null,
  fixSuggestion: null,
});

const runOf = (claims: ClaimView[], status: RunStatus, unitCount = 2): RunResponse => ({
  run: { id: "run-1", status, unitCount, unitsExtracted: unitCount, claimCount: claims.length, createdAt: "t", completedAt: null },
  progress: { checked: 0, total: claims.length },
  counts: {},
  fixList: [],
  claims,
  references: [],
});

const done = (claimId: string, verdict: Verdict = "supported"): CheckResponse => ({
  outcome: "done",
  runCompleted: false,
  verdict: { claimId, verdict, quote: null, page: null, reason: "r", exitStage: 7, fixSuggestion: null },
});

interface Fake {
  claims?: ClaimView[];
  unitCount?: number;
  /** Replies for `check`, per claim id, in order. Defaults to a Supported verdict. */
  checks?: Record<string, CheckResponse[]>;
  checkDelayMs?: number;
  extractError?: Error;
  createError?: Error;
  checkError?: Record<string, Error>;
  statusBefore?: RunStatus;
}

function fakeDeps(fake: Fake = {}) {
  const claims = fake.claims ?? [claim("a", 1), claim("b", 2), claim("c", 3)];
  const unitCount = fake.unitCount ?? 2;
  const log = { extracted: [] as number[], checked: [] as string[], sleeps: [] as number[], getRuns: 0, created: 0 };
  let inFlight = 0;
  let peak = 0;
  const verdicts = new Map<string, Verdict>();
  const queue = new Map(Object.entries(fake.checks ?? {}).map(([id, replies]) => [id, [...replies]]));

  const deps: VerifyDeps = {
    sleep: async (ms) => {
      log.sleeps.push(ms);
    },
    api: {
      async createRun() {
        log.created += 1;
        if (fake.createError) throw fake.createError;
        return { runId: "run-1", status: "extracting", unitCount, referenceCount: 1 };
      },
      async extract(_runId, unit) {
        log.extracted.push(unit);
        if (fake.extractError) throw fake.extractError;
        return { unit, alreadyExtracted: false, claimsAdded: 1, status: "extracting", unitCount, unitsExtracted: log.extracted.length, claimCount: 1 };
      },
      async getRun() {
        log.getRuns += 1;
        const current = claims.map((c) => (verdicts.has(c.id) ? { ...c, verdict: verdicts.get(c.id)!, status: "done" as const } : c));
        const allDone = current.every((c) => c.verdict !== null);
        return runOf(current, allDone ? "completed" : (fake.statusBefore ?? "checking"), unitCount);
      },
      async check(claimId) {
        log.checked.push(claimId);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          if (fake.checkDelayMs) await new Promise((resolve) => setTimeout(resolve, fake.checkDelayMs));
          if (fake.checkError?.[claimId]) throw fake.checkError[claimId];
          const reply = queue.get(claimId)?.shift() ?? done(claimId);
          if (reply.outcome === "done") verdicts.set(claimId, reply.verdict.verdict);
          return reply;
        } finally {
          inFlight -= 1;
        }
      },
    },
  };
  return { deps, log, peak: () => peak };
}

function collect() {
  const events: VerifyEvent[] = [];
  return { events, emit: (event: VerifyEvent) => events.push(event), state: () => events.reduce(reduce, initialState) };
}

const signal = () => new AbortController().signal;

describe("runVerification", () => {
  it("creates the run, extracts every unit, reads the claims, checks them all, and finishes", async () => {
    const { deps, log } = fakeDeps();
    const { events, emit, state } = collect();
    await runVerification(deps, input, emit, signal());

    expect(log.extracted.sort()).toEqual([0, 1]);
    expect(log.checked.sort()).toEqual(["a", "b", "c"]);
    const kinds = events.map((e) => (e.type === "phase" ? `phase:${e.phase}` : e.type));
    expect(kinds[0]).toBe("phase:starting");
    expect(kinds.indexOf("run")).toBeLessThan(kinds.indexOf("phase:extracting"));
    expect(kinds.indexOf("phase:extracting")).toBeLessThan(kinds.indexOf("loaded"));
    expect(kinds.indexOf("phase:checking")).toBeGreaterThan(kinds.indexOf("loaded"));
    expect(kinds.at(-1)).toBe("phase:done");

    const final = state();
    expect(final.phase).toBe("done");
    expect(final.claims.every((c) => c.verdict === "supported")).toBe(true);
    expect(final.runStatus).toBe("completed");
    expect(final.unitsExtracted).toBe(2);
  });

  it("keeps up to 5 claim checks in flight, and no more", async () => {
    const claims = Array.from({ length: 14 }, (_, i) => ({ ...claim(`c${i}`, i + 1), citation: `(Author${i}, 2021)` }));
    const fake = fakeDeps({ claims, checkDelayMs: 5 });
    await runVerification(fake.deps, input, collect().emit, signal());
    expect(fake.peak()).toBe(CHECK_CONCURRENCY);
    expect(fake.log.checked).toHaveLength(14);
  });

  it("checks one claim per citation first, so the others find the reference already looked up", async () => {
    // Four claims cite Smith, two cite Lee, one has no citation.
    const withCitation = (id: string, position: number, citation: string | null) => ({ ...claim(id, position), citation });
    const claims = [
      withCitation("s1", 1, "(Smith, 2021)"),
      withCitation("s2", 2, "(Smith, 2021)"),
      withCitation("l1", 3, "(Lee, 2020)"),
      withCitation("s3", 4, " (smith, 2021) "),
      withCitation("n1", 5, null),
      withCitation("l2", 6, "(Lee, 2020)"),
      withCitation("s4", 7, "(Smith, 2021)"),
    ];
    const fake = fakeDeps({ claims, checkDelayMs: 5 });
    await runVerification(fake.deps, input, collect().emit, signal());
    expect(fake.log.checked).toHaveLength(7);
    // The first wave is the first claim of each distinct citation (s1 and l1); everything else waits for it.
    expect(fake.log.checked.slice(0, 2).sort()).toEqual(["l1", "s1"]);
    expect(fake.log.checked.slice(2).sort()).toEqual(["l2", "n1", "s2", "s3", "s4"]);
  });

  it("splits claims into first-per-citation and the rest without losing or repeating any", () => {
    const mk = (id: string, citation: string | null) => ({ ...claim(id, 1), citation });
    const { first, rest } = oneClaimPerCitation([mk("a", "(X, 1)"), mk("b", "(X, 1)"), mk("c", ""), mk("d", "(Y, 2)"), mk("e", null)]);
    expect(first.map((c) => c.id)).toEqual(["a", "d"]);
    expect(rest.map((c) => c.id)).toEqual(["b", "c", "e"]);
  });

  it("asks the server again when it says retry, waiting a little longer each time, and reports the verdict once", async () => {
    const fake = fakeDeps({
      claims: [claim("a", 1)],
      checks: { a: [{ outcome: "retry", reason: "busy", attempt: 1 }, { outcome: "retry", reason: "busy", attempt: 2 }, done("a", "partial")] },
    });
    const { events, emit, state } = collect();
    await runVerification(fake.deps, input, emit, signal());
    expect(fake.log.checked).toEqual(["a", "a", "a"]);
    expect(fake.log.sleeps).toEqual([1000, 2000]);
    expect(events.filter((e) => e.type === "claim")).toHaveLength(1);
    expect(state().claims[0]!.verdict).toBe("partial");
  });

  it("marks one claim as failed when its check errors, and still checks and finishes the others", async () => {
    const fake = fakeDeps({ checkError: { b: new ApiClientError(500, "internal", "Something went wrong on our side.") } });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    const final = collected.state();
    expect(final.claimErrors).toEqual({ b: "Something went wrong on our side." });
    expect(final.claims.find((c) => c.id === "a")!.verdict).toBe("supported");
    expect(final.claims.find((c) => c.id === "c")!.verdict).toBe("supported");
    expect(final.phase).toBe("done");
  });

  it("never shows a raw error message that is not from the API client", async () => {
    const fake = fakeDeps({ checkError: { a: new Error("secret internal text with the student's sentence") } });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    expect(JSON.stringify(collected.events)).not.toContain("secret internal text");
    expect(collected.state().claimErrors.a).toBe("Something went wrong. Please try again.");
  });

  it("stops with a plain error, and checks nothing, if extraction fails", async () => {
    const fake = fakeDeps({ extractError: new ApiClientError(503, "model_unavailable", "The AI service is busy. Try again in a moment.") });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    expect(collected.state()).toMatchObject({ phase: "error", error: "The AI service is busy. Try again in a moment." });
    expect(fake.log.checked).toEqual([]);
  });

  it("reports a failure to create the run, with the server's message", async () => {
    const fake = fakeDeps({ createError: new ApiClientError(400, "empty", "The draft is empty.") });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    expect(collected.state()).toMatchObject({ phase: "error", error: "The draft is empty." });
    expect(fake.log.extracted).toEqual([]);
  });

  it("finishes straight away, with a message, when no claims were found", async () => {
    const fake = fakeDeps({ claims: [] });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    expect(collected.state()).toMatchObject({ phase: "done", message: "No checkable claims were found." });
    expect(fake.log.checked).toEqual([]);
  });

  it("gives up on a claim that keeps asking for a retry, instead of looping forever", async () => {
    const forever = Array.from({ length: 20 }, (_, i): CheckResponse => ({ outcome: "retry", reason: "busy", attempt: i + 1 }));
    const fake = fakeDeps({ claims: [claim("a", 1)], checks: { a: forever } });
    const collected = collect();
    await runVerification(fake.deps, input, collected.emit, signal());
    expect(fake.log.checked.length).toBe(6);
    expect(collected.state().claimErrors.a).toBe("This claim could not be checked right now.");
  });

  it("stops quietly when aborted, without reporting a failure or finishing", async () => {
    const controller = new AbortController();
    const fake = fakeDeps({ claims: Array.from({ length: 30 }, (_, i) => claim(`c${i}`, i + 1)), checkDelayMs: 5 });
    const collected = collect();
    const running = runVerification(fake.deps, input, collected.emit, controller.signal);
    setTimeout(() => controller.abort(), 8);
    await running;
    const types = collected.events.map((e) => e.type);
    expect(types).not.toContain("failed");
    expect(collected.state().phase).not.toBe("done");
    expect(fake.log.checked.length).toBeLessThan(30);
  });
});

describe("resumeVerification", () => {
  it("checks only the claims that have no verdict yet, and does not extract again", async () => {
    const fake = fakeDeps({ claims: [claim("a", 1, "supported"), claim("b", 2), claim("c", 3)], statusBefore: "checking" });
    const collected = collect();
    await resumeVerification(fake.deps, "run-1", collected.emit, signal());
    expect(fake.log.extracted).toEqual([]);
    expect(fake.log.checked.sort()).toEqual(["b", "c"]);
    expect(collected.state().phase).toBe("done");
  });

  it("finishes the extraction first when the run was still extracting", async () => {
    const fake = fakeDeps({ unitCount: 3, statusBefore: "extracting" });
    const collected = collect();
    await resumeVerification(fake.deps, "run-1", collected.emit, signal());
    expect(fake.log.extracted.sort()).toEqual([0, 1, 2]);
    expect(fake.log.checked.length).toBe(3);
  });

  it("shows a finished run as done without checking anything", async () => {
    const fake = fakeDeps({ claims: [claim("a", 1, "supported"), claim("b", 2, "partial")] });
    const collected = collect();
    await resumeVerification(fake.deps, "run-1", collected.emit, signal());
    expect(fake.log.checked).toEqual([]);
    expect(collected.state()).toMatchObject({ phase: "done", runStatus: "completed" });
  });

  it("reports a run that cannot be opened", async () => {
    const unused = async (): Promise<never> => {
      throw new Error("unused");
    };
    const deps: VerifyDeps = {
      api: {
        createRun: unused,
        extract: unused,
        check: unused,
        getRun: async () => {
          throw new ApiClientError(404, "not_found", "Not found.");
        },
      },
    };
    const collected = collect();
    await resumeVerification(deps, "gone", collected.emit, signal());
    expect(collected.state()).toMatchObject({ phase: "error", error: "Not found." });
  });
});

describe("retryClaim", () => {
  it("clears the claim's error, checks it again, and reloads the run", async () => {
    const failing = fakeDeps({ claims: [claim("a", 1)], checkError: { a: new ApiClientError(500, "internal", "Something went wrong on our side.") } });
    const collected = collect();
    await runVerification(failing.deps, input, collected.emit, signal());
    expect(collected.state().claimErrors.a).toBeDefined();

    const working = fakeDeps({ claims: [claim("a", 1)], checks: { a: [done("a", "partial")] } });
    await retryClaim(working.deps, "run-1", "a", collected.emit, signal());
    expect(collected.state().claimErrors).toEqual({});
    expect(collected.state().claims[0]!.verdict).toBe("partial");
  });

  it("records a new error if the retry fails too", async () => {
    const failing = fakeDeps({ claims: [claim("a", 1)], checkError: { a: new ApiClientError(500, "internal", "Something went wrong on our side.") } });
    const collected = collect();
    await runVerification(failing.deps, input, collected.emit, signal());
    await retryClaim(failing.deps, "run-1", "a", collected.emit, signal());
    expect(collected.state().claimErrors.a).toBe("Something went wrong on our side.");
  });
});
