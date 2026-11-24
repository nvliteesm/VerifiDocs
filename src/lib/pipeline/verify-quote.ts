// Stage 8: verify the judge's quote. This is code, not a model call, and it is the gate behind hard
// rule 1: a verdict that carries a quote must pass this check before it is saved; if it fails, the
// verdict becomes Can't tell.
//
// The check uses the one shared normalization (src/lib/rag/normalize.ts), the same function that
// produced the stored chunk text, so a real quote cannot fail only because of hyphenation, ligatures,
// quote style or spacing.
//
// The stored quote is the exact text of the source (a span of the chunk), not the model's copy, and the
// stored page is the chunk's page, not the page the model said.
import { findQuote, normalizeText } from "../rag/normalize";
import type { JudgePassage, JudgeVerdict, RawJudgment } from "./judge";

/** A very short quote matches almost anywhere, so it is not evidence. Starting values. */
export const MIN_QUOTE_WORDS = 4;
export const MIN_QUOTE_CHARS = 20;
const MAX_REASON_CHARS = 400;

export interface VerifiedJudgment {
  verdict: JudgeVerdict;
  /** The exact source text, or null. Only supported, partial and contradicted carry one. */
  quote: string | null;
  page: number | null;
  chunkId: string | null;
  reason: string;
  /** Set when verification changed the verdict to cant_tell. The judge's original verdict. */
  downgradedFrom?: JudgeVerdict;
  /** The judge named a passage, but the quote was found in a different one. */
  reattributed?: boolean;
}

const NEEDS_QUOTE = new Set<JudgeVerdict>(["supported", "partial", "contradicted"]);

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_REASON_CHARS ? `${oneLine.slice(0, MAX_REASON_CHARS)}...` : oneLine;
}

function downgrade(raw: RawJudgment, reason: string): VerifiedJudgment {
  return {
    verdict: "cant_tell",
    quote: null,
    page: null,
    chunkId: null,
    reason,
    downgradedFrom: raw.verdict,
  };
}

function passageIndexOf(label: string | null): number {
  const match = label ? /^P(\d+)$/i.exec(label.trim()) : null;
  return match ? Number(match[1]) - 1 : -1;
}

export function verifyJudgment(raw: RawJudgment, passages: JudgePassage[]): VerifiedJudgment {
  if (!NEEDS_QUOTE.has(raw.verdict)) {
    // not_in_sources and cant_tell never carry a quote, whatever the model sent.
    return { verdict: raw.verdict, quote: null, page: null, chunkId: null, reason: clip(raw.reason) };
  }

  const quote = raw.quote?.trim() ?? "";
  if (quote.length === 0) {
    return downgrade(raw, "The judge gave no quote, so the verdict could not be verified.");
  }

  const normalizedQuote = normalizeText(quote);
  if (normalizedQuote.split(" ").length < MIN_QUOTE_WORDS || normalizedQuote.length < MIN_QUOTE_CHARS) {
    return downgrade(raw, "The judge's quote was too short to count as evidence.");
  }

  const named = passageIndexOf(raw.chunk_id);
  const namedIsValid = named >= 0 && named < passages.length;
  const order = [
    ...(namedIsValid ? [named] : []),
    ...passages.map((_, index) => index).filter((index) => index !== named),
  ];
  let found: number | undefined;
  let span: { start: number; end: number } | null = null;
  for (const index of order) {
    span = findQuote(quote, passages[index]!.content);
    if (span) {
      found = index;
      break;
    }
  }
  if (found === undefined || !span) {
    return downgrade(raw, "The judge's quote could not be found in the retrieved passages, so the check abstained.");
  }

  // The stored quote is the source's own text at the matched place, never the judge's wording.
  const passage = passages[found]!;
  return {
    verdict: raw.verdict,
    quote: normalizeText(passage.content).slice(span.start, span.end),
    page: passage.pageNumber,
    chunkId: passage.chunkId,
    reason: clip(raw.reason),
    ...(namedIsValid && found !== named ? { reattributed: true } : {}),
  };
}
