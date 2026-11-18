// Stage 1: parse the draft. Pasted text or a .docx becomes plain text with sections, an optional
// trailing reference list, and "extraction units" small enough for one Gemini request each.
// No Gemini call and no database access here.
import mammoth from "mammoth";

/** Starting values. A longer draft is rejected, not silently cut. */
/**
 * About 100 pages. The draft is read in slices of EXTRACTION_UNIT_MAX_CHARS, one short request each, so this is a
 * limit on the free model quota and on how long the scan takes (about 42 requests at the limit), not on one request.
 */
export const MAX_DRAFT_CHARS = 250_000;
export const MAX_DOCX_BYTES = 5 * 1024 * 1024;
export const EXTRACTION_UNIT_MAX_CHARS = 6_000;
/** A longer list is rejected with a message, never cut: a silent cut makes later citations look "not in your list". */
export const MAX_REFERENCES = 500;

export type DraftInput =
  | { kind: "paste"; text: string }
  | { kind: "docx"; buffer: Buffer };

export type DraftErrorCode = "empty" | "too_long" | "docx_too_large" | "docx_unreadable" | "too_many_references";

export class DraftError extends Error {
  override name = "DraftError";
  readonly code: DraftErrorCode;
  constructor(code: DraftErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Section {
  /** The heading line without markdown markers, or null for text before the first heading. */
  heading: string | null;
  text: string;
}

export interface ExtractionUnit {
  index: number;
  text: string;
}

export interface ParsedDraft {
  /** The body, without any trailing reference list. */
  text: string;
  sections: Section[];
  /** Text after a "References" or "Daftar Pustaka" heading, or null if there is none. */
  referenceText: string | null;
  /** The body cut into pieces of at most EXTRACTION_UNIT_MAX_CHARS, for stage 2. */
  units: ExtractionUnit[];
}

const REFERENCE_HEADING =
  /^\s*(?:#{1,6}\s*)?(?:\d+[.)]?\s+)?(?:references?|reference list|bibliography|works cited|daftar pustaka|daftar referensi|referensi|rujukan)\s*:?\s*$/i;

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\t/g, " ")
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function words(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** A heading is a single short line: markdown, a numbered title, or a short title-like line. */
function headingText(paragraph: string): string | null {
  if (paragraph.includes("\n")) return null;
  const line = paragraph.trim();
  if (line.length === 0) return null;

  const markdown = /^#{1,6}\s+(\S.*)$/.exec(line);
  if (markdown) return markdown[1]!.trim();

  const noEndPunctuation = !/[.!?;,:]$/.test(line);
  const numbered = /^\d+(?:\.\d+)*[.)]?\s+\S/.test(line);
  if (numbered && noEndPunctuation && line.length <= 80 && words(line) <= 10) return line;

  const startsUpper = /^[\p{Lu}\d]/u.test(line);
  if (noEndPunctuation && startsUpper && line.length <= 60 && words(line) <= 6) return line;

  return null;
}

function splitLongParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > max) {
      if (current) pieces.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
    } else if (current && current.length + 1 + sentence.length > max) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function buildUnits(paragraphs: string[]): ExtractionUnit[] {
  const units: ExtractionUnit[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) units.push({ index: units.length, text: current });
    current = "";
  };
  for (const paragraph of paragraphs) {
    for (const piece of splitLongParagraph(paragraph, EXTRACTION_UNIT_MAX_CHARS)) {
      if (current && current.length + 2 + piece.length > EXTRACTION_UNIT_MAX_CHARS) flush();
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  flush();
  return units;
}

/**
 * Cuts an already-parsed body (ParsedDraft.text) into extraction units again, exactly as parseDraftText did.
 * It deliberately does not look for a reference list: the body was already separated from it, and a body with
 * a "References" heading of its own (a contents page) must not be split a second time.
 */
export function splitIntoUnits(bodyText: string): ExtractionUnit[] {
  return buildUnits(bodyText.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean));
}

/** Parses already-extracted text. Exported for tests and for the .docx path. */
export function parseDraftText(raw: string): ParsedDraft {
  const cleaned = cleanText(raw);
  if (cleaned.length === 0) throw new DraftError("empty", "The draft is empty.");
  if (cleaned.length > MAX_DRAFT_CHARS) {
    throw new DraftError(
      "too_long",
      `The draft is longer than ${MAX_DRAFT_CHARS} characters. Check it in parts.`,
    );
  }

  const paragraphs = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // The last reference heading wins, so a contents page that mentions "References" is ignored.
  let referenceStart = -1;
  paragraphs.forEach((paragraph, i) => {
    if (!paragraph.includes("\n") && REFERENCE_HEADING.test(paragraph)) referenceStart = i;
  });

  let body = paragraphs;
  let referenceText: string | null = null;
  if (referenceStart >= 0) {
    const refs = paragraphs.slice(referenceStart + 1).join("\n\n").trim();
    if (refs.length > 0) {
      body = paragraphs.slice(0, referenceStart);
      referenceText = refs;
    }
  }

  const sections: Section[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  const closeSection = () => {
    if (heading !== null || buffer.length > 0) sections.push({ heading, text: buffer.join("\n\n") });
  };
  for (const paragraph of body) {
    const found = headingText(paragraph);
    if (found !== null) {
      closeSection();
      heading = found;
      buffer = [];
    } else {
      buffer.push(paragraph);
    }
  }
  closeSection();

  return { text: body.join("\n\n"), sections, referenceText, units: buildUnits(body) };
}

export async function parseDraft(input: DraftInput): Promise<ParsedDraft> {
  if (input.kind === "paste") return parseDraftText(input.text);

  if (input.buffer.byteLength > MAX_DOCX_BYTES) {
    throw new DraftError("docx_too_large", "The .docx file is larger than 5 MB.");
  }
  let text: string;
  try {
    text = (await mammoth.extractRawText({ buffer: input.buffer })).value;
  } catch {
    throw new DraftError("docx_unreadable", "The .docx file could not be read.");
  }
  return parseDraftText(text);
}

/**
 * Splits a pasted reference list into entries. Position is the 1-based index in the result, which is
 * what a numeric citation such as [3] refers to. Blank lines separate entries when present; otherwise
 * numbered or bulleted lines start entries; otherwise each line is one entry (a limitation: an
 * unnumbered list whose entries wrap across lines, with no blank lines, splits too finely).
 */
export function parseReferenceList(raw: string): string[] {
  const text = cleanText(raw);
  if (text.length === 0) return [];

  let lines = text.split("\n");
  const first = lines[0]?.trim() ?? "";
  if (REFERENCE_HEADING.test(first)) lines = lines.slice(1);
  const body = lines.join("\n").trim();
  if (body.length === 0) return [];

  const marker = /^\s*(?:\[\d+\]|\d+[.)]|[-•*])\s+/;
  let groups: string[][];

  if (/\n\s*\n/.test(body)) {
    groups = body.split(/\n\s*\n/).map((block) => block.split("\n"));
  } else {
    const bodyLines = body.split("\n").filter((line) => line.trim().length > 0);
    if (bodyLines.filter((line) => marker.test(line)).length >= 2) {
      groups = [];
      for (const line of bodyLines) {
        if (marker.test(line) || groups.length === 0) groups.push([line]);
        else groups[groups.length - 1]!.push(line);
      }
    } else {
      groups = bodyLines.map((line) => [line]);
    }
  }

  const entries = groups
    .map((group) => group.join(" ").replace(marker, "").replace(/\s+/g, " ").trim())
    .filter((entry) => entry.length >= 10);
  if (entries.length > MAX_REFERENCES) {
    throw new DraftError(
      "too_many_references",
      `Your reference list has ${entries.length} entries. The limit is ${MAX_REFERENCES}. Check one part of your thesis at a time.`,
    );
  }
  return entries;
}
