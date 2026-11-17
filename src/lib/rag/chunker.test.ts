import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_TOKENS,
  chunkPages,
  countTokens,
  hasExtractableText,
  type PageText,
} from "./chunker";
import { normalizeText } from "./normalize";

/** A page of unique words, so each chunk's position in the page is unambiguous. */
function uniqueWordsPage(pageNumber: number, wordCount: number): PageText {
  return {
    pageNumber,
    text: Array.from({ length: wordCount }, (_, i) => `p${pageNumber}w${i}`).join(" "),
  };
}

describe("chunkPages", () => {
  const small = { maxTokens: 30, overlapTokens: 8 };

  it("keeps every chunk within the token limit", () => {
    const chunks = chunkPages([uniqueWordsPage(1, 200)], small);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(30);
      expect(countTokens(chunk.content)).toBeLessThanOrEqual(30 + 2); // per-word counts differ slightly from one pass
    }
  });

  it("never crosses a page and tags each chunk with its page", () => {
    const pages = [uniqueWordsPage(3, 60), uniqueWordsPage(4, 60), uniqueWordsPage(7, 5)];
    const chunks = chunkPages(pages, small);

    for (const chunk of chunks) {
      const page = pages.find((p) => p.pageNumber === chunk.pageNumber)!;
      expect(normalizeText(page.text)).toContain(chunk.content);
      // No word from another page appears in this chunk.
      const prefix = `p${chunk.pageNumber}w`;
      for (const word of chunk.content.split(" ")) expect(word.startsWith(prefix)).toBe(true);
    }
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([3, 4, 7]));
  });

  it("numbers chunks 0, 1, 2 ... across the whole document", () => {
    const chunks = chunkPages([uniqueWordsPage(1, 80), uniqueWordsPage(2, 80)], small);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("covers the whole page: nothing is dropped between chunks", () => {
    const page = uniqueWordsPage(1, 150);
    const chunks = chunkPages([page], small);
    const covered = new Set(chunks.flatMap((c) => c.content.split(" ")));
    for (const word of page.text.split(" ")) expect(covered.has(word)).toBe(true);
    expect(chunks[0]!.content.startsWith("p1w0 ")).toBe(true);
    expect(chunks.at(-1)!.content.endsWith("p1w149")).toBe(true);
  });

  it("overlaps consecutive chunks by no more than the overlap size", () => {
    const chunks = chunkPages([uniqueWordsPage(1, 150)], small);
    for (let i = 0; i + 1 < chunks.length; i += 1) {
      const a = chunks[i]!.content.split(" ");
      const b = chunks[i + 1]!.content.split(" ");
      const shared = a.filter((word) => b.includes(word));
      expect(shared.length).toBeGreaterThan(0); // some overlap
      expect(countTokens(" " + shared.join(" "))).toBeLessThanOrEqual(small.overlapTokens + 2);
      expect(b[0]).not.toBe(a[0]); // always makes progress
    }
  });

  it("is deterministic", () => {
    const pages = [uniqueWordsPage(1, 120), uniqueWordsPage(2, 90)];
    expect(chunkPages(pages, small)).toEqual(chunkPages(pages, small));
  });

  it("skips empty and whitespace-only pages", () => {
    const chunks = chunkPages(
      [{ pageNumber: 1, text: "" }, { pageNumber: 2, text: " \n\t " }, uniqueWordsPage(3, 4)],
      small,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageNumber).toBe(3);
  });

  it("normalizes page text before chunking (hyphenation, ligatures)", () => {
    const [chunk] = chunkPages([{ pageNumber: 1, text: "The inter-\nnational ﬁnancial system" }]);
    expect(chunk!.content).toBe("The international financial system");
  });

  it("puts a single oversized word in its own chunk instead of looping", () => {
    const chunks = chunkPages([{ pageNumber: 1, text: `short ${"x".repeat(400)} tail` }], small);
    expect(chunks.some((c) => c.content === "x".repeat(400))).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("uses about 500 tokens by default", () => {
    const text = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(CHUNK_MAX_TOKENS - 20);
  });

  it("chunks Bahasa Indonesia text without breaking characters", () => {
    const text = "Pemerintah menaikkan suku bunga acuan. ".repeat(80);
    const chunks = chunkPages([{ pageNumber: 2, text }], small);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content).not.toContain("�");
  });

  it("rejects invalid options", () => {
    expect(() => chunkPages([], { maxTokens: 0 })).toThrow();
    expect(() => chunkPages([], { maxTokens: 10, overlapTokens: 10 })).toThrow();
    expect(() => chunkPages([], { maxTokens: 10, overlapTokens: -1 })).toThrow();
  });
});

describe("hasExtractableText", () => {
  it("is false when every page is empty, as in a scanned PDF", () => {
    expect(hasExtractableText([{ pageNumber: 1, text: "" }, { pageNumber: 2, text: " \n " }])).toBe(false);
    expect(hasExtractableText([])).toBe(false);
  });

  it("is true when any page has text", () => {
    expect(hasExtractableText([{ pageNumber: 1, text: "" }, { pageNumber: 2, text: "hello" }])).toBe(true);
  });
});
