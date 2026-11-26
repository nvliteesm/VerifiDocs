import { handle } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/http";
import { confirmEntryHandler, discoverEntryHandler, linkEntryHandler, retrieveEntryHandler } from "@/lib/api/references";

/** Reading a long reference list is many short lookups; the platform default would cut one off. */
export const maxDuration = 60;

/**
 * POST /api/runs/:id/references/:entry/:action, with action one of discover, retrieve, confirm or link. Discover and
 * retrieve open connections to Crossref, OpenAlex and PDF hosts, so they draw on a per-session discovery budget.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; entryId: string; action: string }> }) {
  const { id, entryId, action } = await context.params;
  switch (action) {
    case "discover":
      return handle(request, (ctx) => discoverEntryHandler(ctx, id, entryId), { discovery: true });
    case "retrieve":
      return handle(request, (ctx) => retrieveEntryHandler(ctx, id, entryId), { discovery: true });
    case "confirm":
      return handle(request, (ctx) => confirmEntryHandler(ctx, id, entryId, request));
    case "link":
      return handle(request, (ctx) => linkEntryHandler(ctx, id, entryId, request));
    default:
      return handle(request, async () => {
        throw new ApiError(404, "not_found", "Not found.");
      });
  }
}
