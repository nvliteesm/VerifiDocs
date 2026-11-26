import { handle } from "@/lib/api/handler";
import { contradictionsHandler } from "@/lib/api/figures";

export const maxDuration = 60;

/** POST /api/runs/:id/contradictions: the findings of different sections that may contradict each other. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => contradictionsHandler(ctx, id, request), { model: true });
}
