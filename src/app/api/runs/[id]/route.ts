import { handle } from "@/lib/api/handler";
import { deleteRun, getRun } from "@/lib/api/runs";

/** DELETE /api/runs/:id: delete this check (draft text, claims, verdicts) now, instead of waiting 30 days. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => deleteRun(ctx, id));
}

/** GET /api/runs/:id: progress, every claim with its verdict, and the ranked fix list. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => getRun(ctx, id));
}
