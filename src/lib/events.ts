// Analytics events (docs/events.md). Hard rule 11: events carry ids, counts and buckets, never draft text,
// quotes or reference text. That rule is enforced here by structure, not by care:
//   - every event has a strict schema, so an unexpected key (for example `quote` or `text`) is rejected;
//   - a string is only allowed where it is an enumerated value or a short lowercase token, so a sentence
//     cannot be logged as a prop.
import { z } from "zod";
import type postgres from "postgres";
import { FLAG_REASONS, type FlagReason } from "./flag-reasons";
import type { SqlLike } from "./rag/retrieve";
import { VERDICTS } from "./pipeline/types";

const count = z.number().int().min(0).max(1_000_000);
const ms = z.number().int().min(0).max(86_400_000);
/** A short lowercase token such as "1_to_5". Letters, digits and underscores only, so no free text. */
const token = z.string().regex(/^[a-z0-9_]{1,40}$/);
const verdict = z.enum(VERDICTS);
const answer = z.enum(["yes", "maybe", "no"]);

const verdictCounts = z.strictObject({
  supported: count.optional(),
  partial: count.optional(),
  contradicted: count.optional(),
  not_in_sources: count.optional(),
  cant_tell: count.optional(),
  reference_not_found: count.optional(),
  cant_check: count.optional(),
  no_citation_given: count.optional(),
});

export { FLAG_REASONS, type FlagReason };

export const EVENT_SCHEMAS = {
  session_started: z.strictObject({ source: z.enum(["direct", "referral"]) }),
  draft_submitted: z.strictObject({
    input_type: z.enum(["paste", "docx"]),
    length_bucket: z.enum(["short", "medium", "long"]),
  }),
  // A draft was brought in from a Google Docs link or a PDF (never the link or the text itself).
  draft_imported: z.strictObject({
    source: z.enum(["link", "pdf"]),
    length_bucket: z.enum(["short", "medium", "long"]),
  }),
  references_added: z.strictObject({ count }),
  source_uploaded: z.strictObject({
    page_bucket: z.enum(["1_to_10", "11_to_30", "31_to_100", "over_100"]),
    ingest_ms: ms,
  }),
  run_started: z.strictObject({ claim_count: count }),
  claim_checked: z.strictObject({
    verdict,
    exit_stage: z.number().int().min(2).max(9),
    latency_ms: ms,
    retries: count,
  }),
  run_completed: z.strictObject({ duration_ms: ms, verdict_counts: verdictCounts }),
  evidence_opened: z.strictObject({ verdict }),
  // The student picks one reason from a fixed list. There is no free text, so nothing from the draft or the
  // source can travel in this event (hard rule 11).
  verdict_flagged_wrong: z.strictObject({ verdict, reason: z.enum(FLAG_REASONS) }),
  fix_suggested: z.strictObject({ verdict: z.enum(["partial", "contradicted"]) }),
  fix_accepted: z.strictObject({}),
  recheck_started: z.strictObject({ claims_rechecked: count }),
  report_exported: z.strictObject({ format: z.enum(["copy", "text", "markdown", "csv"]) }),
  would_pay_answered: z.strictObject({ answer }),
  feature_interest_answered: z.strictObject({ feature: token, answer }),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export type EventProps<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>;

/** Validates the props against the event's strict schema, then saves one row. Throws if they do not fit. */
export async function logEvent<N extends EventName>(
  db: SqlLike,
  sessionId: string | null,
  name: N,
  props: EventProps<N>,
): Promise<void> {
  const sql = db as postgres.Sql;
  const parsed = EVENT_SCHEMAS[name].parse(props);
  await sql`
    insert into events (session_id, name, props)
    values (${sessionId}, ${name}, ${sql.json(parsed as postgres.JSONValue)})`;
}

export function lengthBucket(characters: number): "short" | "medium" | "long" {
  if (characters < 2_000) return "short";
  if (characters < 10_000) return "medium";
  return "long";
}

export function pageBucket(pages: number): "1_to_10" | "11_to_30" | "31_to_100" | "over_100" {
  if (pages <= 10) return "1_to_10";
  if (pages <= 30) return "11_to_30";
  if (pages <= 100) return "31_to_100";
  return "over_100";
}
