import { describe, expect, it } from "vitest";
import type { SourceLookup } from "./find-source";
import { runPrelude, type PreludeDeps, type PreludeEntry } from "./prelude";
import type { ReferenceResolution } from "./resolve-reference";

const entries: PreludeEntry[] = [
  { id: "e1", position: 1, raw: "Smith, J., & Lee, K. (2021). Inflation and household spending. Journal of Economics.", documentId: null },
  { id: "e2", position: 2, raw: "Lee, K. (2020). Consumer behaviour under price pressure. Economic Review.", documentId: null },
  { id: "e3", position: 3, raw: "Wijaya, A. (2019). Dampak inflasi terhadap konsumsi. Jurnal Ekonomi.", documentId: null },
];

const found = (title: string): ReferenceResolution => ({
  status: "found", resolver: "crossref", doi: "10.1/x", title, year: 2021, yearMismatch: false,
});

/** Fake lookups. `resolutions` and `sources` are keyed by reference position. */
function deps(options: {
  resolutions?: Record<number, ReferenceResolution>;
  sources?: Record<number, SourceLookup>;
}) {
  const resolved: number[] = [];
  const searched: number[] = [];
  const impl: PreludeDeps = {
    async resolve(entry) {
      resolved.push(entry.position);
      return options.resolutions?.[entry.position] ?? found(`Title ${entry.position}`);
    },
    async findSource(entry) {
      searched.push(entry.position);
      return options.sources?.[entry.position] ?? { kind: "none" };
    },
  };
  return { impl, resolved, searched };
}

describe("runPrelude", () => {
  it("exits with No citation given at stage 2 and looks nothing up", async () => {
    const { impl, resolved } = deps({});
    for (const citation of [null, "", "   "]) {
      const result = await runPrelude({ citation }, entries, impl);
      expect(result).toEqual({
        outcome: "exit",
        exit: { verdict: "no_citation_given", exitStage: 2, reason: "The claim has no citation." },
      });
    }
    expect(resolved).toEqual([]);
  });

  it("exits with Reference not found when the citation is not in the reference list", async () => {
    const { impl, resolved } = deps({});
    const result = await runPrelude({ citation: "(Brown, 2017)" }, entries, impl);
    expect(result).toMatchObject({
      outcome: "exit",
      exit: { verdict: "reference_not_found", exitStage: 3, reason: '"brown 2017" is not in your reference list.' },
    });
    expect(resolved).toEqual([]); // no network call for a citation that is not even listed
  });

  it("exits with Reference not found for a citation that cannot be read", async () => {
    const { impl } = deps({});
    const result = await runPrelude({ citation: "see above" }, entries, impl);
    expect(result).toMatchObject({ outcome: "exit", exit: { verdict: "reference_not_found", exitStage: 3 } });
    expect((result as { exit: { reason: string } }).exit.reason).toMatch(/could not be read/);
  });

  it("exits with Reference not found for a numeric citation beyond the list", async () => {
    const { impl } = deps({});
    const result = await runPrelude({ citation: "[7]" }, entries, impl);
    expect(result).toMatchObject({ outcome: "exit", exit: { verdict: "reference_not_found" } });
    expect((result as { exit: { reason: string } }).exit.reason).toBe("\"[7]\" is not in your reference list.");
  });

  it("exits with Reference not found when Crossref and OpenAlex do not know the entry", async () => {
    const { impl, searched } = deps({ resolutions: { 1: { status: "not_found" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect(result).toMatchObject({
      outcome: "exit",
      exit: { verdict: "reference_not_found", exitStage: 3 },
    });
    expect((result as { exit: { reason: string } }).exit.reason).toMatch(/Reference 1 .* was not found in Crossref or OpenAlex/);
    expect(searched).toEqual([]);
  });

  it("asks for a retry, never a verdict, when a lookup failed", async () => {
    const { impl } = deps({ resolutions: { 1: { status: "error", reason: "Crossref returned HTTP 503" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect(result).toEqual({ outcome: "retry", reason: "Crossref returned HTTP 503" });
  });

  it("exits with Can't check when the reference exists but no PDF matches", async () => {
    const { impl } = deps({ sources: { 1: { kind: "none" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect(result).toMatchObject({ outcome: "exit", exit: { verdict: "cant_check", exitStage: 4 } });
    expect((result as { exit: { reason: string } }).exit.reason).toMatch(/no uploaded source matches/);
  });

  it("exits with Can't check, and says why, when the matching PDF is a scan", async () => {
    const { impl } = deps({ sources: { 1: { kind: "no_text", documentId: "doc-scan" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect(result).toMatchObject({ outcome: "exit", exit: { verdict: "cant_check", exitStage: 4 } });
    expect((result as { exit: { reason: string } }).exit.reason).toMatch(/no readable text/);
  });

  it("is ready, with the matched document, when everything resolves", async () => {
    const { impl } = deps({ sources: { 1: { kind: "found", documentId: "doc-1" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect(result).toMatchObject({ outcome: "ready", documentIds: ["doc-1"] });
    expect((result as { references: unknown[] }).references).toHaveLength(1);
  });

  it("resolves a numeric citation by list position", async () => {
    const { impl, resolved } = deps({ sources: { 3: { kind: "found", documentId: "doc-3" } } });
    const result = await runPrelude({ citation: "[3]" }, entries, impl);
    expect(resolved).toEqual([3]);
    expect(result).toMatchObject({ outcome: "ready", documentIds: ["doc-3"] });
  });

  it("makes the claim Reference not found if ANY of several cited references is not found", async () => {
    const { impl } = deps({
      resolutions: { 2: { status: "not_found" } },
      sources: { 1: { kind: "found", documentId: "doc-1" } },
    });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021; Lee, 2020)" }, entries, impl);
    expect(result).toMatchObject({ outcome: "exit", exit: { verdict: "reference_not_found" } });
  });

  it("checks against the references that have a PDF when others do not", async () => {
    const { impl } = deps({
      sources: { 1: { kind: "found", documentId: "doc-1" }, 2: { kind: "none" } },
    });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021; Lee, 2020)" }, entries, impl);
    expect(result).toMatchObject({ outcome: "ready", documentIds: ["doc-1"] });
    expect((result as { references: unknown[] }).references).toHaveLength(2);
  });

  it("does not look up the same entry twice when a citation repeats it", async () => {
    const { impl, resolved } = deps({ sources: { 1: { kind: "found", documentId: "doc-1" } } });
    await runPrelude({ citation: "[1, 1]" }, entries, impl);
    expect(resolved).toEqual([1]);
  });

  it("deduplicates documents shared by two references", async () => {
    const { impl } = deps({
      sources: { 1: { kind: "found", documentId: "same" }, 2: { kind: "found", documentId: "same" } },
    });
    const result = await runPrelude({ citation: "[1, 2]" }, entries, impl);
    expect(result).toMatchObject({ outcome: "ready", documentIds: ["same"] });
  });

  it("passes a year mismatch through to the caller", async () => {
    const mismatch: ReferenceResolution = { ...(found("T") as Extract<ReferenceResolution, { status: "found" }>), yearMismatch: true };
    const { impl } = deps({ resolutions: { 1: mismatch }, sources: { 1: { kind: "found", documentId: "d" } } });
    const result = await runPrelude({ citation: "(Smith & Lee, 2021)" }, entries, impl);
    expect((result as { references: { resolution: { yearMismatch: boolean } }[] }).references[0]!.resolution.yearMismatch).toBe(true);
  });

  it("never includes draft claim text in a reason (reasons name only citations and references)", async () => {
    const { impl } = deps({});
    const result = await runPrelude({ citation: "(Brown, 2017)" }, entries, impl);
    expect(JSON.stringify(result)).not.toMatch(/inflation rose/i);
  });
});
