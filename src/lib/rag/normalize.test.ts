import { describe, expect, it } from "vitest";
import { UNREADABLE, containsQuote, findQuote, normalizeText } from "./normalize";

// Adam (Kingma & Ba): the PDF's epsilon has no Unicode mapping, so the text layer holds U+000F there (UAT 23 Nov 2026).
const ADAM = "Good default settings for the tested machine learning problems are α = 0.001, β1 = 0.9, β2 = 0.999 and \u000f = 10−8. All operations";

describe("characters the PDF could not decode", () => {
  it("become one visible placeholder, so both sides of the quote check agree", () => {
    expect(normalizeText("and \u000f = 10")).toBe(`and ${UNREADABLE} = 10`);
    expect(normalizeText("symbol  here")).toBe(`symbol ${UNREADABLE} here`); // a private-use font glyph
    expect(normalizeText("broken � here")).toBe(`broken ${UNREADABLE} here`);
  });

  it("leaves tabs, line breaks, vertical tabs and form feeds as spacing (Word uses vertical tabs for line breaks)", () => {
    expect(normalizeText("a\tb\nc\u000bd\u000ce\r\nf")).toBe("a b c d e f");
  });

  it("stays idempotent", () => {
    const once = normalizeText(ADAM);
    expect(normalizeText(once)).toBe(once);
  });
});

describe("findQuote across an unreadable character (the Adam case, UAT 23 Nov 2026)", () => {
  const sentence = (middle: string) => `are α = 0.001, β1 = 0.9, β2 = 0.999 and ${middle}= 10-8.`;

  it("matches when the judge left a space where the character was, which the model did 3 times out of 3", () => {
    expect(containsQuote(sentence("   "), ADAM)).toBe(true);
  });

  it("matches when the judge guessed the symbol, or copied the placeholder", () => {
    expect(containsQuote(sentence("ε "), ADAM)).toBe(true);
    expect(containsQuote(sentence("ϵ "), ADAM)).toBe(true);
    expect(containsQuote(sentence(`${UNREADABLE} `), ADAM)).toBe(true);
  });

  it("gives back the source's own text, with the placeholder, never the judge's guess", () => {
    const quote = sentence("ε ");
    const span = findQuote(quote, ADAM)!;
    const stored = normalizeText(ADAM).slice(span.start, span.end);
    expect(stored).toBe(`are α = 0.001, β1 = 0.9, β2 = 0.999 and ${UNREADABLE} = 10-8.`);
  });

  it("still rejects a quote that differs anywhere else", () => {
    expect(containsQuote(sentence("ε ").replace("10-8", "10-9"), ADAM)).toBe(false);
    expect(containsQuote(sentence("ε ").replace("0.999", "0.99"), ADAM)).toBe(false);
  });

  it("lets the placeholder stand for one character at most", () => {
    expect(containsQuote(sentence("εx "), ADAM)).toBe(false);
  });

  it("does not let a placeholder in the quote match an ordinary character in the source", () => {
    expect(containsQuote(`machine ${UNREADABLE}earning problems`, ADAM)).toBe(false);
  });

  it("finds an ordinary quote exactly as before, at the same place", () => {
    const span = findQuote("tested machine learning problems", ADAM)!;
    expect(normalizeText(ADAM).slice(span.start, span.end)).toBe("tested machine learning problems");
  });
});

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
