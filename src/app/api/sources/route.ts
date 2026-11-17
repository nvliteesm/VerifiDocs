import { handle } from "@/lib/api/handler";
import { listSources, uploadSource } from "@/lib/api/sources";

/** GET /api/sources: the session's sources and their state. */
export async function GET(request: Request) {
  return handle(request, (context) => listSources(context));
}

/** POST /api/sources: upload a PDF (multipart "file"). The file itself is never stored. */
export async function POST(request: Request) {
  return handle(request, (context) => uploadSource(context, request));
}
