import { handle } from "@/lib/api/handler";
import { createRun } from "@/lib/api/runs";

/** POST /api/runs: create a run from a pasted draft (JSON) or a .docx (multipart). */
export async function POST(request: Request) {
  return handle(request, (context) => createRun(context, request));
}
