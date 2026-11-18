import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../client/example";
import { buildJudgePrompt } from "./judge";
import { detectLanguage, explanationLanguage } from "./language";

const passage = [{ chunkId: "c1", pageNumber: 2, content: "Harga pangan naik 7,1 persen pada 2023." }];

describe("detectLanguage", () => {
  it("recognises Bahasa Indonesia", () => {
    expect(detectLanguage("Harga pangan turun pada tahun yang sama")).toBe("id");
    expect(detectLanguage("Biaya sewa adalah pengeluaran terbesar bagi semua kelompok pendapatan")).toBe("id");
    expect(detectLanguage("Penggunaan transportasi umum meningkat setelah jalur bus baru dibuka")).toBe("id");
  });

  it("recognises English", () => {
    expect(detectLanguage("Food prices fell during the same year")).toBe("en");
    expect(detectLanguage("Rent was the largest expense for every income group")).toBe("en");
    expect(detectLanguage("Public transport use doubled after the new bus lines opened")).toBe("en");
  });

  it("says unknown when it cannot tell", () => {
    expect(detectLanguage("")).toBe("unknown");
    expect(detectLanguage("2023 4,2 %")).toBe("unknown");
    expect(detectLanguage("Kota Contoh")).toBe("unknown");
  });

  it("gets every sentence of both example drafts right", () => {
    const sentences = (text: string) => text.split(/(?<=\))\.\s+/);
    for (const sentence of sentences(EXAMPLES.id.draft)) expect(detectLanguage(sentence), sentence).toBe("id");
    for (const sentence of sentences(EXAMPLES.en.draft)) expect(detectLanguage(sentence), sentence).toBe("en");
  });
});

describe("the judge prompt names the language of the reason", () => {
  it("asks for Indonesian for an Indonesian claim", () => {
    const prompt = buildJudgePrompt("Harga pangan turun pada tahun yang sama", passage);
    expect(prompt).toContain('"reason" is one short sentence, written in Indonesian (Bahasa Indonesia), the language of the claim.');
  });

  it("asks for English for an English claim", () => {
    const prompt = buildJudgePrompt("Food prices fell during the same year", passage);
    expect(prompt).toContain('"reason" is one short sentence, written in English, the language of the claim.');
  });

  it("falls back to the general instruction when the language is unclear", () => {
    expect(explanationLanguage("Kota Contoh")).toBe("in the same language as the claim");
    expect(buildJudgePrompt("Kota Contoh", passage)).toContain("in the same language as the claim.");
  });
});
