// Marks the numbers that differ between a student's sentence and the source's quote, so the card shows the
// disagreement ("4.2" against "7.1") without the student comparing two sentences by eye.
//
// This is a fact, not the model's opinion: it follows the same rule as the server's number check in
// pipeline/review.ts (digits without separators, so "0,001" and "0.001" match). That file imports the model
// adapter, so it cannot go into the browser; keep the two rules in step.

const NUMBER = /\d+(?:[.,]\d+)*/g;
/** "(Smith, 2019)", "(Smith and Lee, 2019a)": a bracketed citation holding a year. */
const BRACKETED_YEAR = /\([^()]*\b(?:19|20)\d{2}[a-z]?[^()]*\)/g;

export interface Piece {
  text: string;
  marked: boolean;
}

export interface Marked {
  claim: Piece[];
  quote: Piece[];
  /** True when at least one number was marked. */
  any: boolean;
}

function digitsOf(number: string): string {
  return number.replace(/[.,]/g, "");
}

/** Splits a text into pieces, marking each number whose digits are in `marked`. */
function pieces(text: string, marked: ReadonlySet<string>): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER)) {
    const start = match.index ?? 0;
    if (!marked.has(digitsOf(match[0]))) continue;
    if (start > last) out.push({ text: text.slice(last, start), marked: false });
    out.push({ text: match[0], marked: true });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), marked: false });
  return out.length > 0 ? out : [{ text, marked: false }];
}

/**
 * The claim's numbers that the quote does not contain are marked in the claim. Only when there is such a number
 * are the quote's numbers that the claim does not state marked as well: a quote often holds other figures, and
 * marking them when nothing disagrees would be noise. A citation's own year is not a claim number.
 */
export function markDifferences(claimText: string, citation: string | null, quote: string): Marked {
  const stripped = (citation ? claimText.split(citation).join(" ") : claimText).replace(BRACKETED_YEAR, " ");
  const claimDigits = new Set((stripped.match(NUMBER) ?? []).map(digitsOf));
  const quoteDigits = new Set((quote.match(NUMBER) ?? []).map(digitsOf));
  const missingFromQuote = new Set([...claimDigits].filter((digits) => !quoteDigits.has(digits)));
  if (missingFromQuote.size === 0) {
    return { claim: [{ text: claimText, marked: false }], quote: [{ text: quote, marked: false }], any: false };
  }
  const notInClaim = new Set([...quoteDigits].filter((digits) => !claimDigits.has(digits)));
  return { claim: pieces(claimText, missingFromQuote), quote: pieces(quote, notInClaim), any: true };
}
