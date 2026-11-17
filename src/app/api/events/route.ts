import { handle } from "@/lib/api/handler";
import { postEvent } from "@/lib/api/claims";

/** POST /api/events: report a client-side event. Only the allowed client events are accepted. */
export async function POST(request: Request) {
  return handle(request, (context) => postEvent(context, request));
}
