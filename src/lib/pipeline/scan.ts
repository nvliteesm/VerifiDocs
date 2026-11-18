// The scan: once every part of the draft has been read for claims, the claims that can be judged without any
// network call get their verdict right away. That is a claim with no citation (No citation), a citation that cannot
// be read, and a citation that is not in the reference list (Reference not found): runPrelude would end each of them
// the same way, before any Crossref lookup, source search or model call. The claims that cite something in the
// list stay pending, for the check the student starts when they are ready (and have added their PDFs).
//
// A thesis can hold hundreds of claims, so this saves them in a few statements, not one transaction each. The
// result is the same as saving them one by one: one verdict per claim (the first wins), the claim set to done, and
// one `claim_checked` event each, validated by the same strict schema.
import type postgres from "postgres";
import { EVENT_SCHEMAS } from "../events";
import { matchCitation, type PreludeEntry } from "./prelude";

export interface EarlyVerdictSummary {
  /** Claims that were given a verdict by the scan. */
  saved: number;
}

/** Must run inside a transaction (the run is being closed or left open in the same one). */
export async function saveEarlyVerdicts(tx: postgres.Sql, sessionId: string, runId: string): Promise<EarlyVerdictSummary> {
  const claims = await tx<{ id: string; citation_text: string | null }[]>`
    select c.id, c.citation_text
    from claims c left join verdicts v on v.claim_id = c.id
    where c.run_id = ${runId} and c.session_id = ${sessionId} and c.status <> 'done' and v.id is null`;
  if (claims.length === 0) return { saved: 0 };

  const rows = await tx<{ id: string; position: number; raw_text: string; document_id: string | null }[]>`
    select id, position, raw_text, document_id from reference_entries where run_id = ${runId} order by position`;
  const entries: PreludeEntry[] = rows.map((row) => ({
    id: row.id,
    position: row.position,
    raw: row.raw_text,
    documentId: row.document_id,
  }));

  const ids: string[] = [];
  const verdicts: string[] = [];
  const reasons: string[] = [];
  const stages: number[] = [];
  for (const claim of claims) {
    const result = matchCitation(claim.citation_text, entries);
    if (result.outcome !== "exit") continue;
    ids.push(claim.id);
    verdicts.push(result.exit.verdict);
    reasons.push(result.exit.reason);
    stages.push(result.exit.exitStage);
  }
  if (ids.length === 0) return { saved: 0 };

  const inserted = await tx<{ claim_id: string; verdict: string; exit_stage: number }[]>`
    insert into verdicts (claim_id, session_id, verdict, reason, exit_stage, latency_ms, retries)
    select t.id::uuid, ${sessionId}::uuid, t.verdict, t.reason, t.stage::smallint, 0, 0
    from unnest(${ids}::text[], ${verdicts}::text[], ${reasons}::text[], ${stages}::int[]) as t(id, verdict, reason, stage)
    on conflict (claim_id) do nothing
    returning claim_id, verdict, exit_stage`;
  if (inserted.length === 0) return { saved: 0 };

  await tx`update claims set status = 'done' where id = any(${inserted.map((row) => row.claim_id)}::uuid[])`;

  // One event per verdict, each checked against the strict schema first (hard rule 11).
  const events = inserted.map((row) =>
    JSON.stringify(
      EVENT_SCHEMAS.claim_checked.parse({
        verdict: row.verdict,
        exit_stage: row.exit_stage,
        latency_ms: 0,
        retries: 0,
      }),
    ),
  );
  await tx`
    insert into events (session_id, name, props)
    select ${sessionId}::uuid, 'claim_checked', t.props::jsonb from unnest(${events}::text[]) as t(props)`;

  return { saved: inserted.length };
}
