// Live check of the safe PDF fetcher against REAL DNS and servers. Skipped unless LIVE=1 (npm run test:live).
import { describe, expect, it } from "vitest";
import { PdfFetchError, fetchPdf } from "../../src/lib/pipeline/fetch-pdf";

const live = process.env.LIVE === "1";

async function reason(link: string): Promise<string> {
  try {
    await fetchPdf(link);
    return "fetched";
  } catch (error) {
    return error instanceof PdfFetchError ? error.reason : `other: ${(error as Error).message}`;
  }
}

describe.skipIf(!live)("fetchPdf (live)", () => {
  it("fetches a real open-access PDF", async () => {
    const bytes = await fetchPdf("https://arxiv.org/pdf/1706.03762");
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(100_000);
  }, 20_000);

  it("refuses a web page", async () => {
    expect(await reason("https://example.com/")).toBe("not_pdf");
  }, 20_000);

  it("refuses public names that resolve to this machine, at connect time", async () => {
    // Both are public DNS names whose answer is 127.0.0.1: the address check, not the name, stops them.
    expect(await reason("https://localtest.me/a.pdf")).toBe("blocked_address");
    expect(await reason("https://127.0.0.1.nip.io/a.pdf")).toBe("blocked_address");
  }, 20_000);
});
