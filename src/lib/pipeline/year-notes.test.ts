import { describe, expect, it } from "vitest";
import { yearNotesFor, type YearEntry } from "./year-notes";

const entry = (position: number, raw: string, yearMismatch = false, resolvedYear: number | null = null): YearEntry => ({
  id: `e${position}`,
  position,
  raw,
  documentId: null,
  yearMismatch,
  resolvedYear,
});

const entries = [
  entry(1, "Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers.", false, 2019),
  entry(2, "Mikolov, T., Chen, K., Corrado, G., & Dean, J. (2015). Efficient estimation of word representations in vector space.", true, 2013),
  entry(3, "Pratama, R., & Sari, D. (2022). Pengaruh kecerdasan buatan terhadap integritas akademik mahasiswa."),
];

describe("yearNotesFor", () => {
  it("notes the cited year and the year the paper came out, for a reference whose year is off (UAT 23 Nov 2026)", () => {
    expect(yearNotesFor("(Mikolov et al., 2015)", entries)).toEqual([{ position: 2, cited: 2015, published: 2013 }]);
  });

  it("gives nothing for a reference whose year fits", () => {
    expect(yearNotesFor("(Devlin et al., 2019)", entries)).toEqual([]);
  });

  it("gives nothing for a reference that was not found, or a claim with no citation", () => {
    expect(yearNotesFor("(Pratama & Sari, 2022)", entries)).toEqual([]);
    expect(yearNotesFor(null, entries)).toEqual([]);
  });

  it("gives nothing for a citation that is not in the reference list", () => {
    expect(yearNotesFor("(Brown et al., 2020)", entries)).toEqual([]);
  });

  it("notes only the cited reference that is off when a citation names two", () => {
    expect(yearNotesFor("(Devlin et al., 2019; Mikolov et al., 2015)", entries)).toEqual([{ position: 2, cited: 2015, published: 2013 }]);
  });

  it("gives nothing when the lookup flagged a mismatch but the published year is unknown", () => {
    const unknown = [entry(1, "Mikolov, T. (2015). Efficient estimation of word representations.", true, null)];
    expect(yearNotesFor("(Mikolov, 2015)", unknown)).toEqual([]);
  });
});
