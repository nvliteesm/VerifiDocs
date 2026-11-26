// Stage 3, first half: read a citation marker and find the reference-list entry it points to.
// Pure functions, no network. Supports author-year markers ("(Smith & Lee, 2021)", "Smith (2021)",
// "(Smith et al., 2020; Lee, 2021)", Bahasa "dan" and "dkk.") and numeric markers ("[3]", "[1, 3]", "[2-4]").
import { normalizeText } from "../rag/normalize";

export type CitationMarker =
  | { kind: "author-year"; surnames: string[]; year: number; raw: string }
  | { kind: "numeric"; number: number; raw: string }
  | { kind: "unreadable"; raw: string };

const YEAR = String.raw`(?:1[5-9]\d{2}|20\d{2})`;
const MAX_NUMERIC_RANGE = 20;

/** Words in a citation that are not part of an author's name. */
const NAME_NOISE = new Set([
  "and", "dan", "et", "al", "dkk", "see", "cf", "eg", "ie", "lihat", "dalam", "in", "also", "p", "pp",
]);

/**
 * Citations that point at a document that is not a paper: a law or regulation, a standard, or an institution as the
 * author. Crossref and OpenAlex do not hold these, so "not found there" says nothing about them, and they are not
 * "an author and year". They are told apart so the student gets an honest line ("VerifiDocs does not look these up")
 * and not "Reference not found", which reads as "possibly invented".
 */
export type DocumentCitationKind = "law" | "standard" | "institution";

const LAW = /\b(?:undang[\s-]?undang|uu(?:\s*ri)?\s*(?:no\.?|nomor)|peraturan|perpres|permen\w*|perda|kepmen|keputusan\s+(?:menteri|presiden)|(?:law|act|regulation|decree|directive)\s+(?:no\.?|number)\s*\d)/i;
const STANDARD = /\b(?:sni|iso|astm|jis)[\s:-]*[a-z]?\d|\bpubi\b/i;
const INSTITUTION =
  /\b(?:dinas|badan|kementerian|kemendikbud(?:ristek)?|departemen|pemerintah|biro\s+pusat|bps|who|ministry|department\s+of|bureau|agency|commission|world\s+bank|united\s+nations|unesco|oecd|universit(?:y|as)|institut(?:e)?|politeknik)\b/i;

/** What kind of non-paper document a citation names, or null when it looks like an ordinary author and year. */
export function documentCitationKind(citation: string): DocumentCitationKind | null {
  const text = normalizeText(citation);
  if (LAW.test(text)) return "law";
  if (STANDARD.test(text)) return "standard";
  if (INSTITUTION.test(text)) return "institution";
  return null;
}

/** Lowercase, accents removed, everything but letters and digits turned into single spaces. */
export function normalizeForMatch(text: string): string {
  return normalizeText(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function surnamesFrom(fragment: string): string[] {
  return normalizeForMatch(fragment)
    .split(" ")
    .filter((token) => token.length >= 2 && !NAME_NOISE.has(token) && !/^\d+$/.test(token));
}

function expandNumeric(inner: string): number[] | null {
  const numbers: number[] = [];
  for (const part of inner.split(/[,;]/)) {
    const range = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from >= MAX_NUMERIC_RANGE) return null;
      for (let n = from; n <= to; n += 1) numbers.push(n);
      continue;
    }
    const single = /^\s*(\d{1,3})\s*$/.exec(part);
    if (!single) return null;
    numbers.push(Number(single[1]));
  }
  return numbers;
}

/** Reads one citation string, which may hold several markers. Never throws. */
export function parseCitationMarkers(citation: string): CitationMarker[] {
  const raw = citation.trim();
  const text = normalizeText(raw);

  const numeric = /^[[(]?\s*(\d{1,3}(?:\s*[,;-]\s*\d{1,3})*)\s*[\])]?$/.exec(text);
  if (numeric) {
    const numbers = expandNumeric(numeric[1]!);
    if (numbers && numbers.length > 0) {
      return numbers.map((number) => ({ kind: "numeric", number, raw }));
    }
    return [{ kind: "unreadable", raw }];
  }

  const flat = text.replace(/[[\]()]/g, " ");
  const markers: CitationMarker[] = [];
  for (const part of flat.split(";")) {
    const pattern = new RegExp(String.raw`([^\d]*?)\b(${YEAR})[a-z]?\b`, "gu");
    for (const match of part.matchAll(pattern)) {
      const surnames = surnamesFrom(match[1] ?? "");
      if (surnames.length === 0) continue;
      markers.push({ kind: "author-year", surnames, year: Number(match[2]), raw });
    }
  }
  return markers.length > 0 ? markers : [{ kind: "unreadable", raw }];
}

/** Entry words for matching: initials (one letter) and a leading "the" or "a" are dropped. */
function entryTokens(entry: string): string[] {
  const tokens = normalizeForMatch(entry)
    .split(" ")
    .filter((token) => token.length >= 2);
  while (tokens[0] === "the") tokens.shift();
  return tokens;
}

/**
 * Finds the 0-based index of the reference-list entry a marker points to, or -1 if none matches.
 * - Numeric marker: the entry at that 1-based position.
 * - Author-year marker: the entry must contain the year, and every surname as a whole word. If the
 *   marker names a single author ("Lee, 2021", "Smith et al., 2021"), that author must be the entry's
 *   FIRST author, so "Lee 2021" does not match "Smith & Lee (2021)". With several surnames, order is
 *   not enforced, so a student who lists co-authors in a different order is not falsely flagged.
 * - If several entries match, the one where the first surname appears earliest wins.
 */
export function matchEntryIndex(marker: CitationMarker, entries: string[]): number {
  if (marker.kind === "unreadable") return -1;
  if (marker.kind === "numeric") return marker.number >= 1 && marker.number <= entries.length ? marker.number - 1 : -1;

  const first = marker.surnames[0]!;
  const yearPattern = new RegExp(String.raw`^${marker.year}[a-z]?$`);
  let best = -1;
  let bestAt = Number.POSITIVE_INFINITY;

  entries.forEach((entry, index) => {
    const tokens = entryTokens(entry);
    if (!tokens.some((token) => yearPattern.test(token))) return;
    if (!marker.surnames.every((surname) => tokens.includes(surname))) return;
    const at = tokens.indexOf(first);
    if (marker.surnames.length === 1 && at !== 0) return;
    if (at < bestAt) {
      best = index;
      bestAt = at;
    }
  });
  return best;
}
