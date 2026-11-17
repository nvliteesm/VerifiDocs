import { describe, expect, it } from "vitest";
import { matchEntryIndex, normalizeForMatch, parseCitationMarkers } from "./citations";

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
