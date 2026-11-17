import { handle } from "@/lib/api/handler";
import { checkClaimHandler } from "@/lib/api/claims";

/** POST /api/claims/:id/check: check one claim. Answers `done` with a verdict, or `retry` to call again. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, (ctx) => checkClaimHandler(ctx, id));
}
