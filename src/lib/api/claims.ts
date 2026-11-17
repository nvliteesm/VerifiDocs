// Claim and event handlers.
//
//   POST /api/claims/:id/check   check one claim (stages 3 to 9); the browser keeps up to 5 in flight
//   POST /api/events             client-side events ("this verdict is wrong", evidence opened, ...)
import { z } from "zod";
import type postgres from "postgres";
import { EVENT_SCHEMAS, logEvent, type EventName } from "../events";
import { checkClaim } from "../pipeline/claim-check";
import type { ApiContext } from "./handler";
import { ApiError, assertId, jsonResponse, readJson } from "./http";

export async function checkClaimHandler(context: ApiContext, claimId: string): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  assertId(claimId);

  const [claim] = await sql<{ id: string }[]>`
    select id from claims where id = ${claimId} and session_id = ${context.sessionId}`;
  if (!claim) throw new ApiError(404, "not_found", "Not found.");

  const result = await checkClaim(
    sql,
    {
      llm: context.deps.llm,
      ...(context.deps.resolve ? { resolve: context.deps.resolve } : {}),
      ...(context.deps.now ? { now: context.deps.now } : {}),
    },
    { sessionId: context.sessionId, claimId },
  );

  if (result.outcome === "retry") {
    return jsonResponse({ outcome: "retry", reason: result.reason, attempt: result.attempt });
  }
  const verdict = result.verdict;
  return jsonResponse({
    outcome: "done",
    runCompleted: verdict.runCompleted,
    verdict: {
      claimId: verdict.claimId,
      verdict: verdict.verdict,
      quote: verdict.quote,
      page: verdict.page,
      reason: verdict.reason,
      exitStage: verdict.exitStage,
      fixSuggestion: verdict.fixSuggestion,
    },
  });
}

/** The events a browser may report. The server logs all the others itself, so they cannot be forged. */
export const CLIENT_EVENTS = [
  "evidence_opened",
  "verdict_flagged_wrong",
  "fix_accepted",
  "recheck_started",
  "report_exported",
  "would_pay_answered",
  "feature_interest_answered",
] as const satisfies readonly EventName[];

const eventBody = z.object({ name: z.enum(CLIENT_EVENTS), props: z.record(z.string(), z.unknown()).default({}) });

export async function postEvent(context: ApiContext, request: Request): Promise<Response> {
  const { name, props } = eventBody.parse(await readJson(request));
  const checked = EVENT_SCHEMAS[name].safeParse(props);
  if (!checked.success) throw new ApiError(400, "invalid_request", "The event is not in the expected shape.");
  await logEvent(context.deps.sql, context.sessionId, name, checked.data as never);
  return new Response(null, { status: 204 });
}
