// Page-tagged chunker, ported from the legacy Python chunker (git tag legacy-rag-chat).
//
// - About 500 tokens per chunk with 80 tokens of overlap (starting values, tuned on the eval set).
// - A chunk never crosses a page, so every chunk has exactly one page number.
// - Token counts use one pinned tokenizer (js-tiktoken, cl100k_base, bundled, no download), so chunk
//   boundaries are identical in every environment. Gemini does not use this tokenizer; it is only a
//   deterministic size measure.
// - Chunks are cut at word boundaries, never inside a word or a multi-byte character, so no chunk
//   ends in a broken character that would make an exact quote fail to match.
// - Page text is normalized first (src/lib/rag/normalize.ts), so stored chunks and verified quotes
//   share one normalization.
import { getEncoding, type Tiktoken } from "js-tiktoken";
import { normalizeText } from "./normalize";

export const TOKENIZER = "cl100k_base";
export const CHUNK_MAX_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 80;

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface Chunk {
  /** Position across the whole document, starting at 0. */
  chunkIndex: number;
  pageNumber: number;
  content: string;
  /** Approximate size: the sum of per-word token counts. */
  tokenCount: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

let encoding: Tiktoken | undefined;

function tokenizer(): Tiktoken {
  encoding ??= getEncoding(TOKENIZER);
  return encoding;
}

/** Token count of a text with the pinned tokenizer. */
export function countTokens(text: string): number {
  return tokenizer().encode(text).length;
}

/** False when every page is empty after normalization, as in a scanned PDF (there is no OCR). */
export function hasExtractableText(pages: PageText[]): boolean {
  return pages.some((page) => normalizeText(page.text).length > 0);
}

export function chunkPages(pages: PageText[], options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? CHUNK_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  if (maxTokens < 1) throw new Error("maxTokens must be at least 1.");
  if (overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new Error("overlapTokens must be at least 0 and less than maxTokens.");
  }

  const enc = tokenizer();
  const chunks: Chunk[] = [];

  for (const page of pages) {
    const words = normalizeText(page.text).split(" ").filter((word) => word.length > 0);
    if (words.length === 0) continue;

    // Each word is counted with its leading space, as it would appear inside running text.
    const counts = words.map((word) => enc.encode(` ${word}`).length);

    let start = 0;
    while (start < words.length) {
      let end = start;
      let size = 0;
      // Always take at least one word, so a single oversized word becomes its own chunk.
      while (end < words.length && (end === start || size + counts[end]! <= maxTokens)) {
        size += counts[end]!;
        end += 1;
      }

      chunks.push({
        chunkIndex: chunks.length,
        pageNumber: page.pageNumber,
        content: words.slice(start, end).join(" "),
        tokenCount: size,
      });

      if (end >= words.length) break;

      // Step back to carry about `overlapTokens` of the chunk's tail into the next chunk.
      let next = end;
      let carried = 0;
      while (next > start + 1 && carried + counts[next - 1]! <= overlapTokens) {
        next -= 1;
        carried += counts[next]!;
      }
      start = Math.max(next, start + 1);
    }
  }

  return chunks;
}
