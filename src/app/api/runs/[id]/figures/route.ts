import { handle } from "@/lib/api/handler";
import { readFiguresHandler, savedFiguresHandler } from "@/lib/api/figures";

/** A long table can take the model a while, and a failed part is read again in halves. */
export const maxDuration = 60;

/** POST /api/runs/:id/figures: the figures one part of the draft reports, for the "Check my numbers" tool (saved). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => readFiguresHandler(ctx, id, request), { model: true });
}

/** GET /api/runs/:id/figures: what was saved for this run, so a reload shows the last answer. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => savedFiguresHandler(ctx, id));
}
