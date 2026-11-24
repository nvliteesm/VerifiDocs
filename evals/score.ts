// Scores eval outcomes against the labels (docs/eval.md). Pure: no network, no database, so it is unit tested in CI.
//
// - strict: the verdict equals the expected verdict. This is the score the quality bar uses.
// - lenient: the verdict is the expected one or one of `also_acceptable` (other verdicts the definitions allow).
// - missed: a claim labelled unsupported (partial, contradicted, not_in_sources) that the tool called Supported.
// - Only approved labels are scored (hard rule 10). `includeProposed` scores the rest too, as a marked preview.

export interface EvalClaim {
  id: string;
  language: "en" | "id" | string;
  claim: string;
  citation: string | null;
  expected_verdict: string;
  also_acceptable: string[];
  expected_quote: string | null;
  expected_page: number | null;
  split: "dev" | "held_out" | string;
  seen_in_tuning: boolean;
  status: "proposed" | "approved" | string;
  notes: string;
}

/** One check of one claim in one run. `verdict` is "error" when the check never finished. */
export interface Outcome {
  id: string;
  run: number;
  verdict: string;
  latencyMs: number;
  retries: number;
  /** The Partly supported second look failed, so a claim that may deserve Contradicted kept Partly supported. */
  reviewSkipped?: boolean;
}

const UNSUPPORTED = new Set(["partial", "contradicted", "not_in_sources"]);
/** docs/eval.md: at least 90% correct verdicts, at most 5% missed unsupported claims. */
export const BAR = { strict: 0.9, missed: 0.05 };

interface Rate {
  n: number;
  strict: number;
  lenient: number;
}

export interface EvalReport {
  claims: number;
  runs: number;
  notApproved: number;
  preview: boolean;
  strict: number;
  lenient: number;
  missed: { count: number; of: number; rate: number; ids: string[] };
  meetsBar: boolean;
  errors: number;
  /** Checks that needed more than one round (a lookup or model call failed and was tried again). */
  retried: number;
  /** Checks whose Partly supported second look failed: their verdict says nothing about the review prompt. */
  reviewSkipped: { count: number; ids: string[] };
  byExpected: Record<string, { n: number; strict: number; got: Record<string, number> }>;
  bySplit: Record<string, Rate>;
  byLanguage: Record<string, Rate>;
  unstable: string[];
  latency: { p50: number; p95: number; max: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function rate(outcomes: Outcome[], byId: Map<string, EvalClaim>): Rate {
  const n = outcomes.length;
  const strict = outcomes.filter((o) => o.verdict === byId.get(o.id)!.expected_verdict).length;
  const lenient = outcomes.filter((o) => {
    const c = byId.get(o.id)!;
    return o.verdict === c.expected_verdict || c.also_acceptable.includes(o.verdict);
  }).length;
  return { n: new Set(outcomes.map((o) => o.id)).size, strict: n ? strict / n : 0, lenient: n ? lenient / n : 0 };
}

export function scoreEval(allClaims: EvalClaim[], allOutcomes: Outcome[], options: { includeProposed?: boolean } = {}): EvalReport {
  const scored = allClaims.filter((c) => options.includeProposed || c.status === "approved");
  const byId = new Map(scored.map((c) => [c.id, c]));
  const outcomes = allOutcomes.filter((o) => byId.has(o.id));
  const overall = rate(outcomes, byId);

  const unsupportedOutcomes = outcomes.filter((o) => UNSUPPORTED.has(byId.get(o.id)!.expected_verdict));
  const misses = unsupportedOutcomes.filter((o) => o.verdict === "supported");
  const missed = {
    count: misses.length,
    of: unsupportedOutcomes.length,
    rate: unsupportedOutcomes.length ? misses.length / unsupportedOutcomes.length : 0,
    ids: [...new Set(misses.map((o) => o.id))],
  };

  const byExpected: EvalReport["byExpected"] = {};
  for (const o of outcomes) {
    const expected = byId.get(o.id)!.expected_verdict;
    const row = (byExpected[expected] ??= { n: 0, strict: 0, got: {} });
    row.got[o.verdict] = (row.got[o.verdict] ?? 0) + 1;
  }
  for (const [expected, row] of Object.entries(byExpected)) {
    const mine = outcomes.filter((o) => byId.get(o.id)!.expected_verdict === expected);
    row.n = new Set(mine.map((o) => o.id)).size;
    row.strict = mine.filter((o) => o.verdict === expected).length / mine.length;
  }

  const group = (key: (c: EvalClaim) => string) => {
    const result: Record<string, Rate> = {};
    for (const value of new Set(scored.map(key))) result[value] = rate(outcomes.filter((o) => key(byId.get(o.id)!) === value), byId);
    return result;
  };

  const verdictsById = new Map<string, Set<string>>();
  for (const o of outcomes) (verdictsById.get(o.id) ?? verdictsById.set(o.id, new Set()).get(o.id)!).add(o.verdict);
  const unstable = [...verdictsById].filter(([, verdicts]) => verdicts.size > 1).map(([id]) => id);

  const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
  return {
    claims: scored.length,
    runs: new Set(outcomes.map((o) => o.run)).size,
    notApproved: allClaims.length - allClaims.filter((c) => c.status === "approved").length,
    preview: Boolean(options.includeProposed) && scored.some((c) => c.status !== "approved"),
    strict: overall.strict,
    lenient: overall.lenient,
    missed,
    meetsBar: overall.strict >= BAR.strict && missed.rate <= BAR.missed,
    errors: outcomes.filter((o) => o.verdict === "error").length,
    retried: outcomes.filter((o) => o.retries > 0).length,
    reviewSkipped: {
      count: outcomes.filter((o) => o.reviewSkipped).length,
      ids: [...new Set(outcomes.filter((o) => o.reviewSkipped).map((o) => o.id))],
    },
    byExpected,
    bySplit: group((c) => c.split),
    byLanguage: group((c) => c.language),
    unstable,
    latency: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: latencies.at(-1) ?? 0 },
  };
}
