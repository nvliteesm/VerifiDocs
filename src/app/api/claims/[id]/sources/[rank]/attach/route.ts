import { handle } from "@/lib/api/handler";
import { attachSourceHandler } from "@/lib/api/sources-found";

/**
 * POST /api/claims/:id/sources/:rank/attach: check a claim against a paper Find a source found. JSON (or no body)
 * fetches the paper's open-access PDF; multipart with "file" uses a PDF the student uploads.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; rank: string }> }) {
  const { id, rank } = await context.params;
  return handle(request, (ctx) => attachSourceHandler(ctx, id, rank, request), { model: true });
}
