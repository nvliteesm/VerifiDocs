import { describe, expect, it } from "vitest";
import { inTextCitation, referenceEntry } from "./cite";

const paper = (authors: string[], year: number | null = 2021) => ({
  authors,
  year,
  title: "Flexible work in small firms",
  venue: "Journal of Work",
  doi: "https://doi.org/10.1/w1",
});

describe("inTextCitation", () => {
  it("follows APA 7 for one, two and three or more authors", () => {
    expect(inTextCitation(paper(["Kim Lee"]))).toBe("(Lee, 2021)");
    expect(inTextCitation(paper(["Kim Lee", "Mei Tan"]))).toBe("(Lee & Tan, 2021)");
    expect(inTextCitation(paper(["Kim Lee", "Mei Tan", "Budi Santoso"]))).toBe("(Lee et al., 2021)");
  });

  it("keeps a one-word name, writes n.d. with no year, and uses the title with no author", () => {
    expect(inTextCitation(paper(["Sukarno"]))).toBe("(Sukarno, 2021)");
    expect(inTextCitation(paper(["Kim Lee"], null))).toBe("(Lee, n.d.)");
    expect(inTextCitation(paper([]))).toBe("(Flexible work in small, 2021)");
  });
});

describe("referenceEntry", () => {
  it("lists authors as surname and initials, then year, title, venue and DOI", () => {
    expect(referenceEntry(paper(["Kim Lee", "Mei Ling Tan", "Sukarno"]))).toBe(
      "Lee, K., Tan, M. L., & Sukarno (2021). Flexible work in small firms. Journal of Work. https://doi.org/10.1/w1",
    );
    expect(referenceEntry(paper(["Kim Lee"]))).toBe("Lee, K. (2021). Flexible work in small firms. Journal of Work. https://doi.org/10.1/w1");
  });

  it("puts the title first when there is no author, and leaves out what is missing", () => {
    expect(referenceEntry({ authors: [], year: null, title: "A report.", venue: null, doi: null })).toBe("A report. (n.d.).");
  });
});
