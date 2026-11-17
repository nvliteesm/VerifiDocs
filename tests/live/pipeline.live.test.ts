// Live checks of stages 2 and 3 against the REAL services. Skipped unless LIVE=1 (npm run test:live).
// They use only synthetic text: well-known public references, one invented reference, and a made-up draft.
// Results depend on the live services and on the model, so some assertions may need updating over time.
// These print what they see; read the output as well as the pass/fail.
import { describe, expect, it } from "vitest";
import { createLlm, loadLlmConfig } from "../../src/lib/llm/adapter";
import { extractClaims } from "../../src/lib/pipeline/extract-claims";
import { extractPdfPages } from "../../src/lib/pipeline/ingest";
import { resolveReference } from "../../src/lib/pipeline/resolve-reference";
import { chunkPages } from "../../src/lib/rag/chunker";
import { containsQuote } from "../../src/lib/rag/normalize";

const live = process.env.LIVE === "1";

const references = {
  realEnglish:
    "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
  realWithDoi:
    "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539",
  realWrongYear:
    "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2012). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
  inventedEnglish:
    "Smith, J., & Lee, K. (2021). Quantum inflation dynamics in household spending patterns. Journal of Applied Findings, 12(3), 45-67.",
  inventedBahasa:
    "Rahmawati, D. (2019). Pengaruh inflasi terhadap konsumsi rumah tangga di Indonesia. Jurnal Ekonomi dan Pembangunan Indonesia, 7(2), 101-118.",
  fakeDoi:
    "Nguyen, T. (2020). A made up study of nothing in particular. Journal of Nothing. https://doi.org/10.9999/not-a-real-doi-123",
};

describe.skipIf(!live)("stage 3 against Crossref and OpenAlex (live)", () => {
  it("separates real references from invented ones", async () => {
    const results: Record<string, Awaited<ReturnType<typeof resolveReference>>> = {};
    for (const [name, raw] of Object.entries(references)) results[name] = await resolveReference(raw);

    console.log(
      Object.entries(results)
        .map(([name, r]) =>
          r.status === "found"
            ? `${name.padEnd(16)} found via ${r.resolver} (${r.year}) yearMismatch=${r.yearMismatch}`
            : `${name.padEnd(16)} ${r.status}${r.status === "error" ? `: ${r.reason}` : ""}`,
        )
        .join("\n"),
    );

    expect(results.realEnglish!.status).toBe("found");
    expect(results.realWithDoi!.status).toBe("found");
    expect(results.realWrongYear).toMatchObject({ status: "found", yearMismatch: true });
    expect(results.inventedEnglish!.status).toBe("not_found");
    expect(results.inventedBahasa!.status).toBe("not_found");
    expect(results.fakeDoi!.status).toBe("not_found");
  }, 120_000);
});

const draft = [
  "Inflation in the country rose to 5 percent in 2023 (Smith & Lee, 2021). Households responded by cutting discretionary spending.",
  "Tingkat pengangguran turun menjadi 5,3 persen pada tahun 2022 (Wijaya dkk., 2019). Saya akan membahas metode penelitian pada bab berikutnya.",
  "The central bank raised interest rates by 25 basis points in March. In my opinion this was a sensible decision.",
  "Recent work shows that transformer models outperform recurrent networks on translation [3].",
].join("\n\n");

describe.skipIf(!live)("stage 2 against Gemini (live)", () => {
  it("extracts claims from an English and Bahasa Indonesia draft, verbatim", async () => {
    const llm = createLlm(loadLlmConfig());
    const result = await extractClaims(llm, draft);

    console.log(
      result.claims.map((c, i) => `${i + 1}. ${c.citation ?? "(no citation)"} | ${c.text}`).join("\n") +
        `\ndropped: ${JSON.stringify(result.dropped)}`,
    );

    expect(result.claims.length).toBeGreaterThanOrEqual(3);
    // Every returned claim is verbatim text from the draft (the code guarantees it).
    for (const claim of result.claims) expect(draft).toContain(claim.text.slice(0, 20));
    // At least one claim keeps its citation, and at least one is correctly left without one.
    expect(result.claims.some((c) => c.citation !== null)).toBe(true);
    expect(result.claims.some((c) => c.citation === null)).toBe(true);
    // The student's own plan and opinion are not factual claims.
    expect(result.claims.some((c) => /Saya akan membahas|In my opinion/.test(c.text))).toBe(false);
  }, 120_000);
});

describe.skipIf(!live)("stage 5 against a real PDF (live)", () => {
  it("reads a real two-column paper and finds quoted sentences inside its chunks", async () => {
    // A public paper, downloaded into memory only. It is never written to disk.
    const response = await fetch("https://arxiv.org/pdf/1706.03762", {
      headers: { "User-Agent": "VerifiDocs-portfolio/0.1" },
    });
    expect(response.ok).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const started = Date.now();
    const pages = await extractPdfPages(bytes);
    const chunks = chunkPages(pages);
    console.log(
      `pdf: ${Math.round(bytes.byteLength / 1024)} KB, ${pages.length} pages, ${chunks.length} chunks, ` +
        `${Date.now() - started} ms\npage 1 starts: ${pages[0]!.text.slice(0, 150)}`,
    );

    const quotes = [
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms",
    ];
    for (const quote of quotes) {
      const hit = chunks.find((chunk) => containsQuote(quote, chunk.content));
      console.log(`quote found on page ${hit?.pageNumber ?? "NOT FOUND"}: "${quote.slice(0, 55)}..."`);
      expect(hit, `quote not found in any chunk: ${quote.slice(0, 40)}`).toBeDefined();
    }

    expect(pages.length).toBeGreaterThan(10);
    expect(pages[0]!.text).toContain("Attention Is All You Need");
    expect(chunks.every((chunk) => !chunk.content.includes("�"))).toBe(true);
  }, 120_000);
});
