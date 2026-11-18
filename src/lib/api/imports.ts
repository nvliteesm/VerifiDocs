// Import handler: bring a draft in from a Google Docs link or a PDF, and hand the text back to the browser.
//
//   POST /api/import    JSON { url }  or  multipart "file" (a PDF)  ->  { text, source, warnings, truncated }
//
// The text is not saved. The student sees it in the draft box, can edit it, and only the check saves a draft. The
// link is never stored or logged (hard rule 11: the event carries only the source and a length bucket).
import { z } from "zod";
import type postgres from "postgres";
import { lengthBucket, logEvent } from "../events";
import { MAX_IMPORT_CHARS, ImportError, fetchGoogleDocText, normalizeImportedText, readPdfDraft } from "../pipeline/import-draft";
import { MAX_PDF_BYTES } from "../pipeline/ingest";
import type { ApiContext } from "./handler";
import { jsonResponse, readJson, readUpload } from "./http";

const linkBody = z.object({ url: z.string().min(1).max(2_000) });

export async function importDraft(context: ApiContext, request: Request): Promise<Response> {
  const sql = context.deps.sql as postgres.Sql;
  let text: string;
  let source: "link" | "pdf";
  let warnings: ("footnotes" | "tables")[] = [];

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const upload = await readUpload(request, "file", MAX_PDF_BYTES);
    text = await readPdfDraft(upload.bytes);
    source = "pdf";
  } else {
    const { url } = linkBody.parse(await readJson(request));
    const raw = await fetchGoogleDocText(url, context.deps.fetch ? { fetchImpl: context.deps.fetch } : {});
    ({ text, warnings } = normalizeImportedText(raw));
    source = "link";
  }

  if (text.replace(/\s/g, "").length === 0) throw new ImportError("import_empty", "No text was found in it.");

  await logEvent(sql, context.sessionId, "draft_imported", { source, length_bucket: lengthBucket(text.length) });
  const truncated = text.length > MAX_IMPORT_CHARS;
  return jsonResponse({ text: truncated ? text.slice(0, MAX_IMPORT_CHARS) : text, source, warnings, truncated });
}
