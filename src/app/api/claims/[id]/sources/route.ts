import { handle } from "@/lib/api/handler";
import { findSourcesHandler } from "@/lib/api/sources-found";

/** POST /api/claims/:id/sources: Find a source for one uncited claim. A second press returns the saved result. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => findSourcesHandler(ctx, id), { model: true });
}
