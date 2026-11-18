import { describe, expect, it } from "vitest";
import { EVENT_SCHEMAS, FLAG_REASONS, lengthBucket, pageBucket, type EventName } from "./events";

const valid: Record<EventName, unknown> = {
  session_started: { source: "direct" },
  draft_submitted: { input_type: "docx", length_bucket: "medium" },
  draft_imported: { source: "link", length_bucket: "long" },
  references_added: { count: 12 },
  source_uploaded: { page_bucket: "11_to_30", ingest_ms: 4200 },
  run_started: { claim_count: 31 },
  claim_checked: { verdict: "partial", exit_stage: 8, latency_ms: 5300, retries: 1 },
  run_completed: { duration_ms: 90000, verdict_counts: { supported: 20, partial: 5, cant_tell: 1 } },
  evidence_opened: { verdict: "supported" },
  verdict_flagged_wrong: { verdict: "contradicted", reason: "wrong_page" },
  fix_suggested: { verdict: "partial" },
  fix_accepted: {},
  recheck_started: { claims_rechecked: 4 },
  report_exported: { format: "markdown" },
  would_pay_answered: { answer: "maybe" },
  feature_interest_answered: { feature: "humanizer", answer: "no" },
  sources_suggested: { count: 2, latency_ms: 4200, outcome: "found" },
};

describe("event schemas", () => {
  it("has a schema for every event in docs/events.md, and each accepts a valid example", () => {
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual(Object.keys(valid).sort());
    for (const name of Object.keys(valid) as EventName[]) {
      expect(EVENT_SCHEMAS[name].safeParse(valid[name]).success, name).toBe(true);
    }
  });

  it("rejects any unexpected key, so text such as a quote or a claim cannot be added to an event", () => {
    for (const name of Object.keys(valid) as EventName[]) {
      const withText = { ...(valid[name] as object), quote: "The dominant sequence transduction models" };
      expect(EVENT_SCHEMAS[name].safeParse(withText).success, `${name} + quote`).toBe(false);
      const withDraft = { ...(valid[name] as object), draft_text: "Inflation rose to 5 percent" };
      expect(EVENT_SCHEMAS[name].safeParse(withDraft).success, `${name} + draft_text`).toBe(false);
    }
  });

  it("does not let a sentence into a string prop", () => {
    expect(EVENT_SCHEMAS.would_pay_answered.safeParse({ answer: "yes", price_bucket: "Inflation rose to 5 percent" }).success).toBe(false);
    expect(EVENT_SCHEMAS.would_pay_answered.safeParse({ answer: "yes", note: "free text" }).success).toBe(false);
    // The reason is one of a fixed list: free text, a missing reason and an unknown reason are all refused.
    const flag = EVENT_SCHEMAS.verdict_flagged_wrong;
    expect(flag.safeParse({ verdict: "contradicted", reason: "The quote on page 4 says 5 percent, not what you wrote" }).success).toBe(false);
    expect(flag.safeParse({ verdict: "contradicted" }).success).toBe(false);
    expect(flag.safeParse({ verdict: "contradicted", reason: "other", note: "text" }).success).toBe(false);
    for (const reason of FLAG_REASONS) expect(flag.safeParse({ verdict: "contradicted", reason }).success).toBe(true);
    expect(EVENT_SCHEMAS.feature_interest_answered.safeParse({ feature: "a long free text answer", answer: "yes" }).success).toBe(false);
    expect(EVENT_SCHEMAS.feature_interest_answered.safeParse({ feature: "x".repeat(41), answer: "yes" }).success).toBe(false);
    expect(EVENT_SCHEMAS.claim_checked.safeParse({ verdict: "Smith 2021", exit_stage: 8, latency_ms: 1, retries: 0 }).success).toBe(false);
  });

  it("limits numbers to sane ranges and whole numbers", () => {
    expect(EVENT_SCHEMAS.claim_checked.safeParse({ verdict: "supported", exit_stage: 1, latency_ms: 1, retries: 0 }).success).toBe(false);
    expect(EVENT_SCHEMAS.claim_checked.safeParse({ verdict: "supported", exit_stage: 10, latency_ms: 1, retries: 0 }).success).toBe(false);
    expect(EVENT_SCHEMAS.claim_checked.safeParse({ verdict: "supported", exit_stage: 8, latency_ms: -1, retries: 0 }).success).toBe(false);
    expect(EVENT_SCHEMAS.claim_checked.safeParse({ verdict: "supported", exit_stage: 8, latency_ms: 1.5, retries: 0 }).success).toBe(false);
  });

  it("only allows a fix event for the verdicts that get a fix", () => {
    expect(EVENT_SCHEMAS.fix_suggested.safeParse({ verdict: "supported" }).success).toBe(false);
    expect(EVENT_SCHEMAS.fix_suggested.safeParse({ verdict: "contradicted" }).success).toBe(true);
  });

  it("only allows the eight verdicts as keys of verdict_counts", () => {
    expect(EVENT_SCHEMAS.run_completed.safeParse({ duration_ms: 1, verdict_counts: { maybe: 1 } }).success).toBe(false);
  });
});

describe("buckets", () => {
  it("buckets draft length", () => {
    expect([0, 1999, 2000, 9999, 10000, 50000].map(lengthBucket)).toEqual(["short", "short", "medium", "medium", "long", "long"]);
  });

  it("buckets page counts", () => {
    expect([1, 10, 11, 30, 31, 100, 101, 300].map(pageBucket)).toEqual([
      "1_to_10", "1_to_10", "11_to_30", "11_to_30", "31_to_100", "31_to_100", "over_100", "over_100",
    ]);
  });
});
