import { handle } from "@/lib/api/handler";
import { extractUnit } from "@/lib/api/runs";

/** POST /api/runs/:id/extract: extract the claims of one unit of the draft ({ "unit": n }). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => extractUnit(ctx, id, request));
}
