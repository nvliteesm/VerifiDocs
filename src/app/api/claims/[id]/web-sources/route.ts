import { handle } from "@/lib/api/handler";
import { findWebSourcesHandler } from "@/lib/api/web-sources";

/** POST /api/claims/:id/web-sources: Search the web for one uncited claim. A second press returns the saved result. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => findWebSourcesHandler(ctx, id), { model: true });
}
