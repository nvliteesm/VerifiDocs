import { handle } from "@/lib/api/handler";
import { deleteSource } from "@/lib/api/sources";

/** DELETE /api/sources/:id: remove a source with its pages and chunks. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => deleteSource(ctx, id));
}
