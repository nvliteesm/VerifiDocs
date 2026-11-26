import { handle } from "@/lib/api/handler";
import { listReferencesHandler } from "@/lib/api/references";

/** GET /api/runs/:id/references: every reference-list entry and where its source file stands. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => listReferencesHandler(ctx, id));
}
