// The one text-normalization function (docs/rebuild-brief.md, "Quote normalization").
//
// It is applied to page text BEFORE chunking, so stored chunks are already normalized, and again to
// the judge's quote when the quote is verified. Using one function on both sides means a quote that
// is really in the source cannot fail only because of hyphenation, ligatures, quote style or spacing.
//
// It must stay idempotent: normalizeText(normalizeText(x)) === normalizeText(x).
// It is deliberately case-sensitive: verification is an exact match apart from the above.

/** Soft hyphen, zero-width space/joiners, word joiner, byte-order mark. */
const INVISIBLE = /[­​‌‍⁠﻿]/g;

/**
 * What a character the PDF could not decode becomes. A symbol font with no Unicode mapping leaves a control character
 * or a private-use glyph in the text layer (Adam's epsilon came out as U+000F, UAT 23 Nov 2026). It is made visible,
 * the same on both sides of the quote check, and findQuote lets it stand for the one symbol it hides.
 */
export const UNREADABLE = "�";
/** Control characters except tab, line feed, vertical tab, form feed and carriage return; private-use glyphs; U+FFFD. */
const UNDECODABLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\p{Co}�]/gu;

export function normalizeText(input: string): string {
  // NFKC expands ligatures (ﬁ, ﬂ, ﬃ ...) and turns non-breaking spaces into plain spaces.
  let text = input.normalize("NFKC");

  text = text.replace(INVISIBLE, "");
  text = text.replace(UNDECODABLE, UNREADABLE);

  // Curly quotes to straight quotes; all dash variants and the minus sign to a plain hyphen.
  text = text.replace(/[‘’‚‛]/g, "'");
  text = text.replace(/[“”„‟]/g, '"');
  text = text.replace(/[‐‑‒–—―−]/g, "-");

  // A word broken across lines with a hyphen ("inter-\nnational") is rejoined without the hyphen.
  text = text.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, "$1$2");
  // A hyphen at a line end before a capital or a digit ("Jakarta-\nSelatan", "2019-\n2020") is a
  // real hyphen: keep it and drop only the line break.
  text = text.replace(/-[ \t]*\r?\n[ \t]*(?=[^\p{Ll}\s])/gu, "-");

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Matches `needle` against `text` from position `si`, returning where the match ends. Every character must be equal,
 * except that an UNREADABLE character in the source may stand for exactly one character of the quote (the symbol it
 * hides), or for nothing (the judge left it out, and the spaces around it count once).
 */
function matchFrom(text: string, si: number, needle: string, ni: number): number | null {
  while (ni < needle.length) {
    if (si >= text.length) return null;
    if (text[si] === UNREADABLE) {
      if (needle[ni] !== " ") {
        const asOne = matchFrom(text, si + 1, needle, ni + 1);
        if (asOne !== null) return asOne;
      }
      const after = text[si - 1] === " " && text[si + 1] === " " ? si + 2 : si + 1;
      return matchFrom(text, after, needle, ni);
    }
    if (text[si] !== needle[ni]) return null;
    si += 1;
    ni += 1;
  }
  return si;
}

/**
 * Where `quote` appears in `source`, both normalized, as offsets into normalizeText(source). Exact, as before, except
 * across characters the PDF could not decode (see UNREADABLE). The span is the source's own text: slicing it never
 * puts the judge's words into the evidence (hard rule 1).
 */
export function findQuote(quote: string, source: string): { start: number; end: number } | null {
  const needle = normalizeText(quote);
  if (needle.length === 0) return null;
  const text = normalizeText(source);
  const exact = text.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };
  if (!text.includes(UNREADABLE)) return null;
  for (let start = 0; start < text.length; start += 1) {
    const end = matchFrom(text, start, needle, 0);
    if (end !== null) return { start, end };
  }
  return null;
}

/** True when `quote` appears in `source`, comparing both after normalization (see findQuote). */
export function containsQuote(quote: string, source: string): boolean {
  return findQuote(quote, source) !== null;
}
