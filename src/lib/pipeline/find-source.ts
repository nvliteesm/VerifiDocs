// Stage 4: find the uploaded source file for a resolved reference.
//
// Reads only: the session's documents that are 'ready' or 'no_text', and the first three pages of each.
// A source is matched, in order of strength, by (1) a link the student made, (2) the DOI printed in the
// first pages (or, for an arXiv DOI, the arXiv id), (3) the resolved title printed in the first pages,
// (4) the title words in the filename.
// The filename is the only clue for a scanned PDF, which has no text to read.
import type { SqlLike } from "../rag/retrieve";
import { normalizeForMatch } from "./citations";
import type postgres from "postgres";

const HEAD_PAGES = 3;
const FILENAME_TITLE_MATCH_MIN = 0.6;
const MIN_TITLE_TOKENS = 2;

export type SourceLookup =
  | { kind: "found"; documentId: string }
  /** A matching PDF was uploaded but has no extractable text (a scan; there is no OCR). */
  | { kind: "no_text"; documentId: string }
  | { kind: "none" };

export interface FindSourceArgs {
  sessionId: string;
  /** A document the student linked to this reference, if any. It wins over any guess. */
  linkedDocumentId?: string | null;
  /** DOI of the resolved reference, if known. */
  doi?: string | null;
  /** Title of the resolved reference. */
  title: string;
}

interface Row {
  id: string;
  status: "ready" | "no_text";
  filename: string;
  head: string;
}

function titleTokens(title: string): string[] {
  return normalizeForMatch(title).split(" ").filter((token) => token.length >= 2);
}

function lookupOf(row: Pick<Row, "id" | "status">): SourceLookup {
  return row.status === "ready" ? { kind: "found", documentId: row.id } : { kind: "no_text", documentId: row.id };
}

const ENTRY_FILENAME_SHARE_MIN = 0.8;
const ENTRY_HEAD_SHARE_MIN = 0.6;
const MIN_ENTRY_TOKEN_LENGTH = 4;

/**
 * Matches an uploaded PDF to a reference entry that Crossref and OpenAlex do not know (a government report,
 * a thesis, a web page). With no resolved title to compare, two signals are used, in order of strength:
 * (2) most distinctive words of the entry appear in the first pages of the PDF, (1) the filename's words are
 * (nearly) all words of the entry, as in "Bank-Indonesia-2024.pdf" for "Bank Indonesia. (2024). ...".
 */
export function matchEntryToDocuments(
  raw: string,
  rows: Pick<Row, "id" | "status" | "filename" | "head">[],
): SourceLookup {
  const entryTokens = new Set(normalizeForMatch(raw).split(" ").filter(Boolean));
  const distinctive = [...entryTokens].filter((token) => token.length >= MIN_ENTRY_TOKEN_LENGTH);
  const matches: { row: Pick<Row, "id" | "status">; strength: number; share: number }[] = [];

  for (const row of rows) {
    let strength = 0;
    let share = 0;
    const headTokens = new Set(normalizeForMatch(row.head).split(" ").filter(Boolean));
    if (distinctive.length >= MIN_TITLE_TOKENS && headTokens.size > 0) {
      const headShare = distinctive.filter((token) => headTokens.has(token)).length / distinctive.length;
      if (headShare >= ENTRY_HEAD_SHARE_MIN) {
        strength = 2;
        share = headShare;
      }
    }
    if (strength === 0) {
      const fileTokens = normalizeForMatch(row.filename.replace(/\.pdf$/i, ""))
        .split(" ")
        .filter((token) => token.length >= 2);
      if (fileTokens.length >= MIN_TITLE_TOKENS) {
        const fileShare = fileTokens.filter((token) => entryTokens.has(token)).length / fileTokens.length;
        if (fileShare >= ENTRY_FILENAME_SHARE_MIN) {
          strength = 1;
          share = fileShare;
        }
      }
    }
    if (strength > 0) matches.push({ row, strength, share });
  }
  if (matches.length === 0) return { kind: "none" };
  // Several PDFs can clear the bar when papers share a topic's vocabulary: the one that shares the most words wins, not the first uploaded.
  matches.sort((a, b) => b.strength - a.strength || b.share - a.share || Number(b.row.status === "ready") - Number(a.row.status === "ready"));
  return lookupOf(matches[0]!.row);
}

/** Finds an uploaded PDF for a reference entry that no online service resolved. Reads only. */
export async function findSourceForEntry(
  db: SqlLike,
  args: { sessionId: string; linkedDocumentId?: string | null; raw: string },
): Promise<SourceLookup> {
  const sql = db as postgres.Sql;
  if (args.linkedDocumentId) {
    return findSourceDocument(db, { sessionId: args.sessionId, linkedDocumentId: args.linkedDocumentId, title: args.raw });
  }
  const rows = await sql<Row[]>`
    select d.id, d.status, d.filename,
           coalesce(string_agg(p.text, ' ' order by p.page_number), '') as head
    from documents d
    left join pages p on p.document_id = d.id and p.page_number <= ${HEAD_PAGES}
    where d.session_id = ${args.sessionId} and d.status in ('ready', 'no_text')
    group by d.id, d.status, d.filename, d.created_at
    order by d.created_at, d.id`;
  return matchEntryToDocuments(args.raw, rows);
}

export async function findSourceDocument(db: SqlLike, args: FindSourceArgs): Promise<SourceLookup> {
  const sql = db as postgres.Sql;

  if (args.linkedDocumentId) {
    const [linked] = await sql<{ id: string; status: string }[]>`
      select id, status from documents
      where id = ${args.linkedDocumentId} and session_id = ${args.sessionId}`;
    if (linked && (linked.status === "ready" || linked.status === "no_text")) {
      return lookupOf({ id: linked.id, status: linked.status });
    }
    return { kind: "none" };
  }

  const rows = await sql<Row[]>`
    select d.id, d.status, d.filename,
           coalesce(string_agg(p.text, ' ' order by p.page_number), '') as head
    from documents d
    left join pages p on p.document_id = d.id and p.page_number <= ${HEAD_PAGES}
    where d.session_id = ${args.sessionId} and d.status in ('ready', 'no_text')
    group by d.id, d.status, d.filename, d.created_at
    order by d.created_at, d.id`;
  return matchResolvedToDocuments(rows, { title: args.title, doi: args.doi });
}

/**
 * Is `normalizedTitle` printed in `head` (both normalized) as this paper's title, and not just as words in a sentence?
 *
 * A distinctive title (SHORT_TITLE_WORDS words or more) counts anywhere in the first pages. A short, generic one does
 * not: "Deep learning", LeCun et al.'s title, is also in the introduction of Adam, BatchNorm, GAN and the Walters paper
 * (eval of 24 Nov 2026: a claim citing LeCun, whose PDF was not uploaded, was checked against Adam). A paper's own
 * short title sits on its title page, so it must start within TITLE_NEAR_TOP_CHARS of the text. In that eval every
 * paper's own title started at character 0 to 115, and every false match at 1,258 or later.
 */
const SHORT_TITLE_WORDS = 5;
const TITLE_NEAR_TOP_CHARS = 400;

function titleIsPrintedAsTitle(head: string, normalizedTitle: string): boolean {
  const at = ` ${head} `.indexOf(` ${normalizedTitle} `);
  if (at < 0) return false;
  return normalizedTitle.split(" ").length >= SHORT_TITLE_WORDS || at <= TITLE_NEAR_TOP_CHARS;
}

/** "10.48550/arxiv.1412.6980" -> "1412.6980". An arXiv PDF prints "arXiv:1412.6980v9", never this DOI. */
function arxivIdOf(doi: string): string | null {
  const match = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Picks the uploaded PDF for a reference that Crossref or OpenAlex resolved, from each PDF's filename and the text
 * of its first pages. Exported for tests; findSourceDocument reads the rows and calls it.
 */
export function matchResolvedToDocuments(
  rows: Pick<Row, "id" | "status" | "filename" | "head">[],
  args: { title: string; doi?: string | null },
): SourceLookup {
  if (rows.length === 0) return { kind: "none" };

  const title = titleTokens(args.title);
  // The whole title, one-letter words included: "in a neural network" must not become "in neural network",
  // which never occurs in the page text (UAT 23 Nov 2026: Adam and Hinton's papers were never matched).
  const normalizedTitle = normalizeForMatch(args.title);
  const doi = args.doi?.trim().toLowerCase() ?? "";
  const arxivId = arxivIdOf(doi);
  const arxivPattern = arxivId ? new RegExp(`arxiv:\\s*${arxivId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d.])`) : null;
  const matches: { row: Pick<Row, "id" | "status">; strength: number }[] = [];

  for (const row of rows) {
    const head = normalizeForMatch(row.head);
    const rawHead = row.head.toLowerCase();
    let strength = 0;

    if (doi.length > 0 && rawHead.includes(doi)) strength = 3;
    else if (arxivPattern && arxivPattern.test(rawHead)) strength = 3;
    else if (title.length >= MIN_TITLE_TOKENS && titleIsPrintedAsTitle(head, normalizedTitle)) strength = 2;
    else if (title.length >= MIN_TITLE_TOKENS) {
      const fileTokens = new Set(normalizeForMatch(row.filename.replace(/\.pdf$/i, "")).split(" "));
      const share = title.filter((token) => fileTokens.has(token)).length / title.length;
      if (share >= FILENAME_TITLE_MATCH_MIN) strength = 1;
    }
    if (strength > 0) matches.push({ row, strength });
  }
  if (matches.length === 0) return { kind: "none" };

  // Strongest match first; among equals, a readable PDF beats a scan, then the earliest upload.
  matches.sort(
    (a, b) =>
      b.strength - a.strength ||
      Number(b.row.status === "ready") - Number(a.row.status === "ready"),
  );
  return lookupOf(matches[0]!.row);
}
