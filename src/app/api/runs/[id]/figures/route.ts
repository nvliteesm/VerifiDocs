import { handle } from "@/lib/api/handler";
import { readFiguresHandler } from "@/lib/api/figures";

/** A long table can take the model a while, and a failed part is read again in halves. */
export const maxDuration = 60;

/** POST /api/runs/:id/figures: the figures one part of the draft reports, for the "Check my numbers" tool. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => readFiguresHandler(ctx, id, request), { model: true });
}
