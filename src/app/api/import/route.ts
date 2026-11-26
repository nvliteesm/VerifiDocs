import { handle } from "@/lib/api/handler";
import { importDraft } from "@/lib/api/imports";

/** POST /api/import: read a draft from a Google Docs link (JSON { url }) or a PDF (multipart "file"). Nothing is saved. */
/** Reading a long Google Doc can take Google a while; the platform default would cut it off first. */
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, (context) => importDraft(context, request), { imports: true });
}
