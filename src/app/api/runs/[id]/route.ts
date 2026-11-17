import { handle } from "@/lib/api/handler";
import { getRun } from "@/lib/api/runs";

/** GET /api/runs/:id: progress, every claim with its verdict, and the ranked fix list. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => getRun(ctx, id));
}
