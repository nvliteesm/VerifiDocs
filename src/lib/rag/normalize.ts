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

export function normalizeText(input: string): string {
  // NFKC expands ligatures (ﬁ, ﬂ, ﬃ ...) and turns non-breaking spaces into plain spaces.
  let text = input.normalize("NFKC");

  text = text.replace(INVISIBLE, "");

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

/** True when `quote` appears in `source`, comparing both after normalization. */
export function containsQuote(quote: string, source: string): boolean {
  const needle = normalizeText(quote);
  return needle.length > 0 && normalizeText(source).includes(needle);
}
