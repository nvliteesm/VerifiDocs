import { handle } from "@/lib/api/handler";
import { ingestSource } from "@/lib/api/sources";

/** POST /api/sources/:id/ingest: chunk, embed and save the next batch of pages. Call until `done`. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => ingestSource(ctx, id), { model: true });
}
