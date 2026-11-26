import { describe, expect, it } from "vitest";
import { documentCitationKind, editDistance, matchEntryIndex, normalizeForMatch, parseCitationMarkers, standardId, standardMismatch, suggestForMarker, suggestionFromReason } from "./citations";

const authorYear = (surnames: string[], year: number) => ({
  kind: "author-year" as const,
  surnames,
  year,
});

function simplified(citation: string) {
  return parseCitationMarkers(citation).map((m) =>
    m.kind === "author-year"
      ? authorYear(m.surnames, m.year)
      : m.kind === "numeric"
        ? { kind: m.kind, number: m.number }
        : { kind: m.kind },
  );
}

describe("parseCitationMarkers", () => {
  it("reads common author-year forms", () => {
    expect(simplified("(Smith, 2021)")).toEqual([authorYear(["smith"], 2021)]);
    expect(simplified("(Smith & Lee, 2021)")).toEqual([authorYear(["smith", "lee"], 2021)]);
    expect(simplified("(Smith and Lee 2021)")).toEqual([authorYear(["smith", "lee"], 2021)]);
    expect(simplified("(Smith et al., 2021)")).toEqual([authorYear(["smith"], 2021)]);
    expect(simplified("Smith (2021)")).toEqual([authorYear(["smith"], 2021)]);
    expect(simplified("(Smith, 2021, p. 4)")).toEqual([authorYear(["smith"], 2021)]);
    expect(simplified("(Smith, 2021a)")).toEqual([authorYear(["smith"], 2021)]);
  });

  it("reads Bahasa Indonesia forms", () => {
    expect(simplified("(Budi dan Sari, 2020)")).toEqual([authorYear(["budi", "sari"], 2020)]);
    expect(simplified("(Wijaya dkk., 2019)")).toEqual([authorYear(["wijaya"], 2019)]);
    expect(simplified("(Kementerian Keuangan, 2022)")).toEqual([authorYear(["kementerian", "keuangan"], 2022)]);
  });

  it("reads several markers in one citation", () => {
    expect(simplified("(Smith, 2020; Lee, 2021)")).toEqual([
      authorYear(["smith"], 2020),
      authorYear(["lee"], 2021),
    ]);
    expect(simplified("Smith (2020) and Lee (2021)")).toEqual([
      authorYear(["smith"], 2020),
      authorYear(["lee"], 2021),
    ]);
  });

  it("ignores accents and curly punctuation", () => {
    expect(simplified("(Müller, 2018)")).toEqual([authorYear(["muller"], 2018)]);
    expect(simplified("(O’Brien – Lee, 2020)")).toEqual([authorYear(["brien", "lee"], 2020)]);
  });

  it("reads numeric markers and expands ranges", () => {
    expect(simplified("[3]")).toEqual([{ kind: "numeric", number: 3 }]);
    expect(simplified("[1, 3]")).toEqual([
      { kind: "numeric", number: 1 },
      { kind: "numeric", number: 3 },
    ]);
    expect(simplified("[2-4]")).toEqual([
      { kind: "numeric", number: 2 },
      { kind: "numeric", number: 3 },
      { kind: "numeric", number: 4 },
    ]);
    expect(simplified("[2–4]")).toHaveLength(3);
  });

  it("does not read a bare year as a numeric marker", () => {
    expect(simplified("(2021)")).toEqual([{ kind: "unreadable" }]);
  });

  it("marks text with no author and year as unreadable", () => {
    expect(simplified("see above")).toEqual([{ kind: "unreadable" }]);
    expect(simplified("(ibid.)")).toEqual([{ kind: "unreadable" }]);
    expect(simplified("[1-99]")).toEqual([{ kind: "unreadable" }]);
    expect(simplified("")).toEqual([{ kind: "unreadable" }]);
  });
});

describe("matchEntryIndex", () => {
  const entries = [
    "Smith, J., & Lee, K. (2021). Inflation and household spending. Journal of Economics, 12(3), 45-67.",
    "Lee, K. (2020). Consumer behaviour under price pressure. Economic Review, 8(1), 1-20.",
    "Wijaya, A., dkk. (2019). Dampak inflasi terhadap konsumsi. Jurnal Ekonomi, 4(2).",
    "Kementerian Keuangan. (2022). Laporan keuangan pemerintah pusat. Jakarta.",
    "Müller, H. (2018). Price dynamics. Review of Prices.",
  ];

  const match = (citation: string) => matchEntryIndex(parseCitationMarkers(citation)[0]!, entries);

  it("matches author-year markers to the right entry", () => {
    expect(match("(Smith & Lee, 2021)")).toBe(0);
    expect(match("(Smith et al., 2021)")).toBe(0);
    expect(match("(Lee, 2020)")).toBe(1);
    expect(match("(Wijaya dkk., 2019)")).toBe(2);
    expect(match("(Kementerian Keuangan, 2022)")).toBe(3);
    expect(match("Muller (2018)")).toBe(4);
  });

  it("requires the year to match", () => {
    expect(match("(Smith, 2019)")).toBe(-1);
    expect(match("(Smith & Lee, 2020)")).toBe(-1);
  });

  it("requires a single named author to be the entry's FIRST author", () => {
    // Lee is only the second author of the 2021 paper, so "Lee, 2021" must not link to it.
    expect(match("(Lee, 2021)")).toBe(-1);
  });

  it("does not enforce surname order when several surnames are given", () => {
    expect(match("(Lee & Smith, 2021)")).toBe(0);
  });

  it("requires every surname to appear as a whole word", () => {
    expect(match("(Smith & Jones, 2021)")).toBe(-1);
    expect(match("(Smi, 2021)")).toBe(-1);
  });

  it("returns -1 for a citation that is not in the list", () => {
    expect(match("(Brown, 2017)")).toBe(-1);
  });

  it("prefers the entry where the first author appears earliest", () => {
    const list = [
      "Jones, P., & Smith, J. (2021). A second paper. Journal.",
      "Smith, J. (2021). The first paper. Journal.",
    ];
    expect(matchEntryIndex(parseCitationMarkers("(Smith, 2021)")[0]!, list)).toBe(1);
  });

  it("ignores initials and a leading 'The' when finding the first author", () => {
    expect(matchEntryIndex(parseCitationMarkers("(Smith, 2021)")[0]!, ["J. Smith (2021). Title. Journal."])).toBe(0);
    expect(
      matchEntryIndex(parseCitationMarkers("(Economist, 2020)")[0]!, ["The Economist. (2020). Title. Magazine."]),
    ).toBe(0);
  });

  it("maps numeric markers to list positions", () => {
    expect(matchEntryIndex({ kind: "numeric", number: 1, raw: "[1]" }, entries)).toBe(0);
    expect(matchEntryIndex({ kind: "numeric", number: 5, raw: "[5]" }, entries)).toBe(4);
    expect(matchEntryIndex({ kind: "numeric", number: 6, raw: "[6]" }, entries)).toBe(-1);
    expect(matchEntryIndex({ kind: "numeric", number: 0, raw: "[0]" }, entries)).toBe(-1);
  });

  it("never matches an unreadable marker", () => {
    expect(matchEntryIndex({ kind: "unreadable", raw: "see above" }, entries)).toBe(-1);
  });
});

describe("normalizeForMatch", () => {
  it("lowercases, strips accents and punctuation, and collapses spaces", () => {
    expect(normalizeForMatch("  Müller, H.  (2018) ")).toBe("muller h 2018");
  });
});

describe("documentCitationKind", () => {
  it("recognises laws, standards and institutions, in Bahasa and English", () => {
    for (const law of ["Undang-undang Republik Indonesia nomor 28 tahun 2002", "(Undang-Undang No. 23 tahun 1997)", "UU No. 32 Tahun 2009", "Peraturan Menteri PUPR 2017", "Law No. 5 of 2019"]) {
      expect(documentCitationKind(law), law).toBe("law");
    }
    for (const standard of ["SNI 03-0349-1989", "SNI-03-0348-1989", "(PUBI, 1982, h.26)", "ISO 9001:2015", "ASTM C140"]) {
      expect(documentCitationKind(standard), standard).toBe("standard");
    }
    for (const institution of ["Dinas Lingkungan Hidup Kota Pontianak tahun 2018", "(Sampoerna University, 2022)", "(Badan Pusat Statistik, 2020)", "(WHO, 2019)", "(Ministry of Health, 2021)"]) {
      expect(documentCitationKind(institution), institution).toBe("institution");
    }
  });

  it("leaves an ordinary author and year alone", () => {
    for (const citation of ["(Smith & Lee, 2021)", "(Darmono, 2016)", "(Hermanto, dkk., 2014)", "Sugiyono (2017, h.215)", "[3]", "(Wisnu wijanarko, 2008)", "(Dian, 2011 dalam Wibowo, 2013)"]) {
      expect(documentCitationKind(citation), citation).toBeNull();
    }
  });
});

describe("editDistance", () => {
  it("counts single edits and stops counting once past the cap", () => {
    expect(editDistance("hermanto", "hermanta")).toBe(1);
    expect(editDistance("0348", "0349")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("short", "completelydifferent")).toBeGreaterThan(3);
  });
});

describe("suggestForMarker (did you mean)", () => {
  const list = [
    "Hermanto, Dony, dkk. 2014. Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk. Skripsi. Surakarta.",
    "Darmono. 2006. Teknologi Bahan Bangunan. Jakarta: Erlangga.",
    "Wariyatno, Nanang. 2013. Kuat Tekan dan Kuat Tarik belah. Dinamika Rekayasa.",
    "Lee, K. (2020). Consumer behaviour.",
  ];
  const marker = (citation: string) => parseCitationMarkers(citation)[0]!;

  it("suggests the listed author who is spelled almost the same, with the listed year, as a citation to copy", () => {
    expect(suggestForMarker(marker("(Hermanta, 2021)"), list)).toEqual({ entryIndex: 0, kind: "spelling", text: "(Hermanto, 2014)" });
  });

  it("suggests the listed year when the author is right and the year is not", () => {
    expect(suggestForMarker(marker("(Darmono, 2016)"), list)).toEqual({ entryIndex: 1, kind: "year", text: "(Darmono, 2006)" });
  });

  it("offers nothing for an author who is not close to anyone listed, a short name, or a numeric marker", () => {
    expect(suggestForMarker(marker("(Tandya, 2015)"), list)).toBeNull();
    expect(suggestForMarker(marker("(Leo, 2020)"), list)).toBeNull(); // three letters: too easy to confuse with "Lee"
    expect(suggestForMarker(marker("[3]"), list)).toBeNull();
  });

  it("does not suggest the entry the citation already matches", () => {
    expect(suggestForMarker(marker("(Wariyatno, 2013)"), list)).toBeNull();
  });

  it("backs the suggested citation out of a stored reason", () => {
    expect(suggestionFromReason('"Hermanta 2021" is not in your reference list. Did you mean "(Hermanto, 2014)"?')).toBe("(Hermanto, 2014)");
    expect(suggestionFromReason('"Darmono 2016" is not in your reference list.')).toBeNull();
    expect(suggestionFromReason(null)).toBeNull();
  });
});

describe("standardMismatch", () => {
  const list = ["Badan Standardisasi Nasional. 1989. SNI 03-0349-1989 Bata Beton untuk Pasangan Dinding.", "Smith, J. (2021). Something else. Journal."];

  it("reads a standard's number however it is written", () => {
    expect(standardId("SNI-03-0348-1989")).toMatchObject({ family: "sni", digits: "0303481989" });
    expect(standardId("(SNI 03-0349-1989)")).toMatchObject({ family: "sni", digits: "0303491989", text: "SNI 03-0349-1989" });
    expect(standardId("Smith, 2020")).toBeNull();
  });

  it("flags a cited number that is one digit off a listed one, naming both", () => {
    expect(standardMismatch("SNI-03-0348-1989", list)).toEqual({ cited: "SNI-03-0348-1989", listed: "SNI 03-0349-1989" });
  });

  it("does not flag an exact match, a number far from every listed one, or a different standard family", () => {
    expect(standardMismatch("SNI 03-0349-1989", list)).toBeNull();
    expect(standardMismatch("SNI 15-2049-2004", list)).toBeNull();
    expect(standardMismatch("ISO 03-0348-1989", list)).toBeNull();
    expect(standardMismatch("SNI 03-0348-1989", [])).toBeNull();
  });
});
