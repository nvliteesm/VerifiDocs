// Limits the screen tells the student about. They mirror the server's (src/lib/pipeline/ingest.ts and
// parse-draft.ts); a test checks they are equal. The server is the one that enforces them.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_DOCX_BYTES = 5 * 1024 * 1024;
/** A plain-text draft is read in the browser, so only the browser enforces this. */
export const MAX_TXT_BYTES = 1_000_000;
export const MAX_DRAFT_CHARS = 250_000;
export const MAX_SOURCES = 10;
export const MAX_REFERENCES = 500;

export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
