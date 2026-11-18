// Bringing a draft in without pasting it: from a Google Docs link, or from a PDF.
//
// Google Docs: a document shared as "Anyone with the link" has a plain-text export at
//   https://docs.google.com/document/d/<id>/export?format=txt
// Checked on real public documents on 18 Nov 2026:
//   - the answer is a 307 redirect to https://doc-XX-YY-docstext.googleusercontent.com/..., which then gives the text;
//   - a missing or not-shared document answers 404 (or a redirect to a sign-in page, which is refused here);
//   - the text starts with a byte-order mark and uses \r\n line endings;
//   - a footnote is an inline "[1]" and the notes are appended after a line of underscores;
//   - a table is one cell per line, each starting with a tab;
//   - lists come out as "* item" lines.
// Only docs.google.com and *-docstext.googleusercontent.com are ever fetched, whatever the student pastes: the
// address is built from the document id alone, and a redirect anywhere else is treated as "not public".
//
// PDF: the page text is rebuilt into paragraphs (the quote normaliser flattens everything to one line, which would
// hide the "References" heading), then the student sees and can edit the result.
import { extractText, getDocumentProxy } from "unpdf";
import { LinkError, parseGoogleDocLink } from "../import/google-link";
import { IngestError, MAX_PDF_BYTES, MAX_PDF_PAGES } from "./ingest";

export type ImportErrorCode =
  | "bad_link"
  | "published_link"
  | "not_public"
  | "too_large"
  | "import_busy"
  | "import_failed"
  | "import_empty";

const STATUS: Record<ImportErrorCode, number> = {
  bad_link: 400,
  published_link: 400,
  not_public: 422,
  too_large: 413,
  import_busy: 503,
  import_failed: 502,
  import_empty: 422,
};

export class ImportError extends Error {
  override name = "ImportError";
  readonly code: ImportErrorCode;
  readonly status: number;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
  }
}

export type ImportWarning = "footnotes" | "tables";

export const MAX_IMPORT_BYTES = 2_000_000;
/** What one import may hand back to the browser. A draft over MAX_DRAFT_CHARS is still shown, with the usual hint. */
export const MAX_IMPORT_CHARS = 400_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;

function allowedHost(host: string): boolean {
  return host === "docs.google.com" || /^doc-[a-z0-9-]+-docstext\.googleusercontent\.com$/.test(host);
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () => new ImportError("too_large", "The document is too large to read.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw tooLarge();
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

/** Downloads the plain text of a Google Doc that is shared as "Anyone with the link". Returns it as Google sent it. */
export async function fetchGoogleDocText(link: string, options: FetchOptions = {}): Promise<string> {
  let id: string;
  try {
    ({ id } = parseGoogleDocLink(link));
  } catch (error) {
    if (error instanceof LinkError && error.problem === "published_link") {
      throw new ImportError("published_link", "This is a “Publish to web” link. Use Share, choose “Anyone with the link”, and copy that link.");
    }
    throw new ImportError("bad_link", "That is not a Google Docs link. Copy it from the document's address bar or the Share button.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  // The English wording is the same as the screen's (src/lib/i18n/messages.ts, err.*), so English shows it as it is.
  const notPublic = () => new ImportError("not_public", "The document could not be opened. Make sure Share is set to “Anyone with the link” and the link is right.");
  const failed = () => new ImportError("import_failed", "The document could not be read. Try again, or paste the text.");

  let url = new URL(`https://docs.google.com/document/d/${id}/export?format=txt`);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw failed();
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      let next: URL;
      try {
        next = new URL(response.headers.get("location") ?? "", url);
      } catch {
        throw notPublic();
      }
      // A redirect to a sign-in page (or anywhere that is not Google's own document hosts) means "not public".
      if (next.protocol !== "https:" || next.username !== "" || next.password !== "" || !allowedHost(next.hostname)) {
        throw notPublic();
      }
      url = next;
      continue;
    }

    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImportError("import_busy", "Google is busy. Try again in a minute, or paste the text.");
    }
    if ([401, 403, 404, 410].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw notPublic();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw failed();
    }
    // Plain text is expected. A web page here is a sign-in or error page.
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/plain")) {
      await response.body?.cancel().catch(() => undefined);
      throw notPublic();
    }
    try {
      return await readCapped(response, maxBytes);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw failed();
    }
  }
  throw failed();
}

/**
 * Cleans Google's text export: no byte-order mark, \n line endings, no indentation, no triple blank lines. When the
 * document has footnotes, the footnote block and its inline "[n]" markers are removed: the notes are not references,
 * and a marker left in the text would be read as "reference number n" and matched to the wrong source.
 */
export function normalizeImportedText(raw: string): { text: string; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  let text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");

  // A table cell starts with a tab, so a table is many tab-led lines (checked on real documents: rubric tables are
  // 15 to 80 percent of their lines). A few stray tabs from page breaks or lists (under 5 percent) are not a table.
  const filled = text.split("\n").filter((line) => line.trim() !== "");
  const tabLed = filled.filter((line) => /^\t\s*\S/.test(line)).length;
  if (tabLed >= 6 && tabLed / filled.length >= 0.1) warnings.push("tables");

  text = text.replace(/^[ \t]+/gm, "").replace(/[ \t]+$/gm, "");

  // Footnotes: a line of underscores, then "[1]note" lines to the end.
  const separators = [...text.matchAll(/^_{8,}$/gm)];
  const last = separators[separators.length - 1];
  if (last?.index !== undefined) {
    const after = text.slice(last.index + last[0].length).trim();
    if (/^\[\d+\]/.test(after)) {
      const numbers = new Set([...after.matchAll(/^\[(\d+)\]/gm)].map((match) => match[1]!));
      const body = text.slice(0, last.index);
      text = body.replace(/\[(\d+)\]/g, (marker, number: string) => (numbers.has(number) ? "" : marker));
      warnings.push("footnotes");
    }
  }

  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), warnings };
}

/** Rebuilds paragraphs from the hard-wrapped lines of one PDF page. Best effort: the student can edit the result. */
function reflowPage(pageText: string): string {
  const lines = pageText.split(/\r?\n/).map((line) => line.trim());
  const longest = Math.max(0, ...lines.map((line) => line.length));
  const out: string[] = [];
  let paragraph = "";
  const flush = () => {
    if (paragraph) out.push(paragraph);
    paragraph = "";
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    // A short line with no closing punctuation that starts like a title is a heading: it stands alone.
    const heading = line.length < 60 && !/[.!?:;,)\]"'”’]$/.test(line) && /^[\p{Lu}\d]/u.test(line);
    if (heading) {
      flush();
      out.push(line);
      continue;
    }
    if (paragraph.endsWith("-") && /^\p{Ll}/u.test(line)) paragraph = paragraph.slice(0, -1) + line;
    else paragraph = paragraph ? `${paragraph} ${line}` : line;
    // A short line ends its paragraph (the last line of a paragraph, or of a reference entry).
    if (line.length < longest * 0.6) flush();
  }
  flush();
  return out.join("\n\n");
}

/** Reads the text of a PDF the student wrote their draft in. A scan (no text layer) is refused. */
export async function readPdfDraft(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new IngestError("too_large", `The PDF is larger than ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`);
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new IngestError("not_a_pdf", "The file is not a PDF.");

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes)); // PDF.js may take ownership of the buffer, so it gets a copy
  } catch {
    throw new IngestError("unreadable", "The PDF could not be read. It may be damaged or password-protected.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new IngestError("too_many_pages", `The PDF has more than ${MAX_PDF_PAGES} pages.`);
    const { text } = await extractText(pdf, { mergePages: false });
    const joined = text.map(reflowPage).filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (joined.replace(/\s/g, "").length < 20) {
      throw new ImportError("import_empty", "No text was found in it. Scanned files cannot be read.");
    }
    return joined;
  } catch (error) {
    if (error instanceof IngestError || error instanceof ImportError) throw error;
    throw new IngestError("unreadable", "The text of the PDF could not be read.");
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
