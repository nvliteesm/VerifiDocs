// What kind of work a reference-list entry describes. Source matching and wording depend on it: a journal article that
// Crossref and OpenAlex cannot find may be mistyped or invented, but a thesis, a conference paper, a law, a standard or a
// government report is often simply not indexed there (Indonesian ones very often), so "not found online" says nothing
// about it. Pure function, no network. Keeps to what the entry text shows; anything it cannot tell is "unknown".
import { documentCitationKind } from "./citations";

export type ReferenceType = "journal" | "book" | "thesis" | "proceedings" | "regulation" | "standard" | "institution" | "unknown";

const THESIS = /\b(?:skripsi|tesis|thesis|disertasi|dissertation|tugas akhir|final project)\b/i;
const PROCEEDINGS = /\b(?:proceedings?|e-proceeding|prosiding|seminar nasional|konferensi|conference|symposium|simposium)\b/i;
/** The author slot is an institution: "Dinas Lingkungan Hidup Kota Pontianak. 2018. ...", "WHO (2019)". */
const INSTITUTION_AUTHOR = /^\W*(?:dinas|badan|kementerian|kemendikbud(?:ristek)?|departemen|pemerintah|biro pusat|bps|who|ministry|department of|bureau|agency|commission|world bank|united nations|unesco|oecd)\b/i;
const JOURNAL = /\bjurnal\b|\bjournal\b|\bvol(?:ume)?\.?\s*\d|\b\d{1,3}\(\d{1,3}\)\s*,|doi\.org\/|\b10\.\d{4,9}\//i;
const BOOK_WORDS = /\bisbn\b|\b(?:penerbit|publisher|press|erlangga|gramedia|andi offset|rajagrafindo|pustaka pelajar)\b/i;
/** "... Jakarta: Erlangga." at the end: a place, a colon, a publisher. Case matters here, so it is kept apart. */
const BOOK_PLACE = /\.\s*[\p{Lu}][\p{L} ]{2,25}:\s*[\p{Lu}][\p{L} &.]{2,40}\.?\s*$/u;

export function classifyReference(raw: string): ReferenceType {
  const text = raw.replace(/\s+/g, " ").trim();
  const kind = documentCitationKind(text);
  if (kind === "law") return "regulation";
  if (kind === "standard") return "standard";
  // The kind of work is named after the title ("... Judul. Skripsi. Surakarta", "... e-Proceeding of ..."), so only that part
  // is read for it: a journal article about "penulisan skripsi" is still a journal article.
  const title = referenceTitle(text);
  const venue = title.length > 0 && title.length < text.length ? text.replace(title, " ") : text;
  if (THESIS.test(venue)) return "thesis";
  if (PROCEEDINGS.test(venue)) return "proceedings";
  if (INSTITUTION_AUTHOR.test(text)) return "institution";
  if (JOURNAL.test(text)) return "journal";
  if (BOOK_WORDS.test(text) || BOOK_PLACE.test(text)) return "book";
  return "unknown";
}

/**
 * Whether "not found in Crossref or OpenAlex" is worth saying about this kind of entry. Only a journal-style entry is:
 * journals are what those indexes are built for, and AI tools invent journal articles. For everything else the honest
 * answer is "could not be retrieved automatically".
 */
export function indexedOnline(type: ReferenceType): boolean {
  return type === "journal";
}

/**
 * The title of a reference-list entry, for showing a missing source by its real name. Tries a quoted title, then the
 * text after the year ("Smith, J. (2020). Title. Journal" or "Nama. 2019. Judul. Jurnal"), then the start of the entry.
 */
export function referenceTitle(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const quoted = /[“"«]([^”"»]{8,220})[”"»]/.exec(text);
  if (quoted) return quoted[1]!.trim().replace(/[.,]$/, "");
  const afterYear = /(?:\((?:1[5-9]|20)\d\d[a-z]?\)\.?|\b(?:1[5-9]|20)\d\d[a-z]?\.)\s*([^.]{8,200})\./.exec(text);
  if (afterYear) return afterYear[1]!.trim();
  return text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text;
}

/** "Hermanto, Dony, dkk. 2014": who and when, for the line under a title. */
export function referenceByline(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const match = /^(.{2,70}?)[\s,.(]*\(?((?:1[5-9]|20)\d\d)[a-z]?\)?/.exec(text);
  if (!match) return "";
  return `${match[1]!.replace(/[\s,.(]+$/, "")} ${match[2]}`;
}
