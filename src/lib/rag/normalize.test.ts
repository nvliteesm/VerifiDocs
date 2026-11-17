import { describe, expect, it } from "vitest";
import { containsQuote, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("expands ligatures", () => {
    expect(normalizeText("The ﬁnancial ofﬁce ﬂoor and eﬀort")).toBe(
      "The financial office floor and effort",
    );
  });

  it("removes soft hyphens and zero-width characters", () => {
    expect(normalizeText("inter­national​ trade﻿")).toBe("international trade");
  });

  it("rejoins a word split across lines by a hyphen", () => {
    expect(normalizeText("The inter-\nnational market")).toBe("The international market");
    expect(normalizeText("The inter-  \r\n  national market")).toBe("The international market");
  });

  it("keeps the hyphen when the next line starts with a capital or a digit", () => {
    expect(normalizeText("Jakarta-\nSelatan")).toBe("Jakarta-Selatan");
    expect(normalizeText("in 2019-\n2020 the")).toBe("in 2019-2020 the");
  });

  it("leaves a normal hyphenated word alone", () => {
    expect(normalizeText("a well-known result")).toBe("a well-known result");
  });

  it("maps curly quotes and dash variants to plain ones", () => {
    expect(normalizeText("“It’s fine” – said — she")).toBe(
      "\"It's fine\" - said - she",
    );
    expect(normalizeText("5−2")).toBe("5-2");
  });

  it("collapses whitespace, including non-breaking spaces and newlines", () => {
    expect(normalizeText("  one two \n\n three\t four  ")).toBe("one two three four");
  });

  it("does not change ordinary Bahasa Indonesia text", () => {
    const text = "Pemerintah menaikkan suku bunga sebesar 25 basis poin pada tahun 2023.";
    expect(normalizeText(text)).toBe(text);
  });

  it("is case sensitive", () => {
    expect(normalizeText("Bank Indonesia")).not.toBe(normalizeText("bank indonesia"));
  });

  it("is idempotent", () => {
    const samples = [
      "The ﬁnancial inter-\nnational “market”",
      "Jakarta-\nSelatan 2019-\n2020 – done",
      "  plain   text  ",
      "",
      "a­b​c",
      "tinggi-\nrendah dan Tinggi-\nRendah",
    ];
    for (const sample of samples) {
      const once = normalizeText(sample);
      expect(normalizeText(once)).toBe(once);
    }
  });
});

describe("containsQuote", () => {
  const source = "The inter-\nnational ﬁnancial system – as noted “works well” in 2020.";

  it("finds a quote that differs from the source only in hyphenation, ligatures, quotes and dashes", () => {
    expect(containsQuote('international financial system - as noted "works well"', source)).toBe(true);
  });

  it("finds a quote whose whitespace differs", () => {
    expect(containsQuote("international   financial\nsystem", source)).toBe(true);
  });

  it("rejects a quote that is not in the source", () => {
    expect(containsQuote("the system fails badly", source)).toBe(false);
  });

  it("rejects a quote that differs in case", () => {
    expect(containsQuote("INTERNATIONAL financial", source)).toBe(false);
  });

  it("rejects an empty or whitespace-only quote", () => {
    expect(containsQuote("", source)).toBe(false);
    expect(containsQuote("   \n ", source)).toBe(false);
  });
});
