// The scheduled purge (hard rule 4). The lazy purge in retention.ts runs only when someone uses the app, so on a quiet
// deployment expired drafts would stay until the next visitor. A scheduler (Vercel Cron on the Hobby plan runs a job
// once a day, which is plenty for a 30-day promise) calls this endpoint instead.
//
// The endpoint has no session and no cookie. It is open to anyone who sends the secret, so it fails closed: with no
// CRON_SECRET configured it refuses everything, and it opens the database only after the secret has matched.
// It answers with counts, never text.
import { createHash, timingSafeEqual } from "node:crypto";
import type { SqlLike } from "../rag/retrieve";
import { purgeNow } from "../retention";

const HEADERS = { "cache-control": "no-store" };

/** Compares hashes of both values, so the check takes the same time whatever the guess and whatever its length. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

export interface CronDeps {
  /** Called only after the secret matched. */
  getSql: () => SqlLike;
  secret: string | undefined;
}

/** GET /api/cron/purge. Expects `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends when CRON_SECRET is set. */
export async function purgeCron(request: Request, deps: CronDeps): Promise<Response> {
  const secret = deps.secret?.trim();
  if (!secret) {
    return Response.json({ error: { code: "not_configured", message: "The purge job has no secret configured." } }, { status: 503, headers: HEADERS });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!sameSecret(token, secret)) {
    return Response.json({ error: { code: "unauthorized", message: "Unauthorized." } }, { status: 401, headers: HEADERS });
  }
  try {
    return Response.json({ ok: true, ...(await purgeNow(deps.getSql())) }, { headers: HEADERS });
  } catch (error) {
    console.error(`Scheduled purge failed: ${error instanceof Error ? error.name : typeof error}`);
    return Response.json({ error: { code: "purge_failed", message: "The purge failed." } }, { status: 500, headers: HEADERS });
  }
}
