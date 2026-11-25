import { purgeCron } from "@/lib/api/cron";
import { getSql } from "@/lib/db";

// Never cached or prerendered: it deletes data when called.
export const dynamic = "force-dynamic";

/** GET /api/cron/purge: delete expired drafts, page text and chunks now. See lib/api/cron.ts. */
export async function GET(request: Request) {
  return purgeCron(request, { getSql, secret: process.env.CRON_SECRET });
}
