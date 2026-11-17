import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasExtractableText } from "../rag/chunker";
import { MAX_PDF_BYTES, extractPdfPages } from "./ingest";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

describe("extractPdfPages", () => {
  it("reads normalized text for each page, in page order", async () => {
    const pages = await extractPdfPages(fixture("sample.pdf"));
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0]!.text).toContain("Attention Is All You Need Ashish Vaswani et al.");
    expect(pages[0]!.text).not.toContain("\n"); // normalized: newlines collapsed
    expect(pages[1]!.text).toContain("Tingkat inflasi tahunan naik menjadi 5 persen pada tahun 2023.");
    expect(pages[2]!.text).toContain("Households reduced discretionary spending in 2023.");
  });

  it("returns empty text for a PDF with no text layer, which hasExtractableText reports as a scan", async () => {
    const pages = await extractPdfPages(fixture("scanned.pdf"));
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.text === "")).toBe(true);
    expect(hasExtractableText(pages)).toBe(false);
  });

  it("does not modify or consume the bytes it is given", async () => {
    const bytes = fixture("sample.pdf");
    const before = Buffer.from(bytes).toString("base64");
    await extractPdfPages(bytes);
    expect(Buffer.from(bytes).toString("base64")).toBe(before);
    expect(bytes.byteLength).toBeGreaterThan(0);
    // And the same bytes can be read again.
    expect(await extractPdfPages(bytes)).toHaveLength(3);
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(extractPdfPages(new TextEncoder().encode("hello, this is plain text"))).rejects.toMatchObject({
      code: "not_a_pdf",
    });
  });

  it("rejects a damaged PDF", async () => {
    await expect(
      extractPdfPages(new TextEncoder().encode("%PDF-1.4\nthis is not a real pdf body at all")),
    ).rejects.toMatchObject({ code: "unreadable" });
  });

  it("rejects a PDF over the size limit before parsing it", async () => {
    await expect(extractPdfPages(new Uint8Array(MAX_PDF_BYTES + 1))).rejects.toMatchObject({ code: "too_large" });
    await expect(extractPdfPages(fixture("sample.pdf"), { maxBytes: 100 })).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("rejects a PDF over the page limit", async () => {
    await expect(extractPdfPages(fixture("sample.pdf"), { maxPages: 2 })).rejects.toMatchObject({
      code: "too_many_pages",
    });
  });
});
