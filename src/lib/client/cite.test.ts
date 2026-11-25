import { describe, expect, it } from "vitest";
import { inTextCitation, referenceEntry, webInTextCitation, webReferenceEntry } from "./cite";

const paper = (authors: string[], year: number | null = 2021) => ({
  authors,
  year,
  title: "Flexible work in small firms",
  venue: "Journal of Work",
  doi: "https://doi.org/10.1/w1",
});

describe("web page citations", () => {
  const page = {
    site: "stats.example.gov",
    title: "Labour force survey.",
    url: "https://stats.example.gov/labour",
    retrievedAt: "2026-11-25T12:00:00.000Z",
  };

  it("uses the site as the author and n.d. for the date, because the page's own are not known", () => {
    expect(webInTextCitation(page)).toBe("(stats.example.gov, n.d.)");
  });

  it("builds an APA 7 reference with the day the page was retrieved, in English whatever the interface language", () => {
    expect(webReferenceEntry(page)).toBe(
      "stats.example.gov. (n.d.). Labour force survey. Retrieved November 25, 2026, from https://stats.example.gov/labour",
    );
  });

  it("gives the retrieved day in UTC, so the same page is cited the same way anywhere", () => {
    expect(webReferenceEntry({ ...page, retrievedAt: "2026-11-25T23:30:00.000Z" })).toContain("Retrieved November 25, 2026");
  });

  it("falls back to the address alone when the date cannot be read", () => {
    expect(webReferenceEntry({ ...page, retrievedAt: "not a date" })).toBe("stats.example.gov. (n.d.). Labour force survey. https://stats.example.gov/labour");
  });
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
