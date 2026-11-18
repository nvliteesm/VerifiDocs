import { describe, expect, it } from "vitest";
import { LinkError, looksLikeGoogleDocLink, parseGoogleDocLink } from "./google-link";

const ID = "1zNfrhNd-YvYB6stWLrujUCABad9c6EQcCdJWlmdfMe8";

describe("parseGoogleDocLink", () => {
  it("finds the document id in the links a student copies", () => {
    for (const link of [
      `https://docs.google.com/document/d/${ID}/edit?usp=sharing`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://docs.google.com/document/d/${ID}/edit?tab=t.0`,
      `https://docs.google.com/document/d/${ID}`,
      `https://docs.google.com/document/d/${ID}/`,
      `https://docs.google.com/document/u/1/d/${ID}/edit`,
      `docs.google.com/document/d/${ID}/edit`,
      `  https://docs.google.com/document/d/${ID}/edit?usp=sharing \n`,
      `http://docs.google.com/document/d/${ID}/edit`,
    ]) {
      expect(parseGoogleDocLink(link), link).toEqual({ id: ID });
    }
  });

  it("refuses anything that is not a Google Docs document, so the server never fetches another address", () => {
    for (const link of [
      "",
      "   ",
      "my draft is about household spending",
      `https://evil.example/document/d/${ID}/edit`,
      `https://docs.google.com.evil.example/document/d/${ID}/edit`,
      `https://evil.example/?next=https://docs.google.com/document/d/${ID}`,
      `https://user:secret@docs.google.com/document/d/${ID}/edit`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com/presentation/d/${ID}/edit`,
      `https://drive.google.com/file/d/${ID}/view`,
      `https://docs.google.com/document/d/short/edit`,
      `https://docs.google.com/document/d/${ID} extra words`,
      `ftp://docs.google.com/document/d/${ID}`,
      `javascript:alert(1)`,
      `file:///etc/passwd`,
      `https://127.0.0.1/document/d/${ID}`,
      `https://docs.google.com/document/${ID}`,
      `https://docs.google.com/document/d/${"a".repeat(2_100)}`,
    ]) {
      expect(() => parseGoogleDocLink(link), link).toThrow(LinkError);
    }
  });

  it("recognises a Publish to web link and says so, instead of calling it a bad link", () => {
    const published = "https://docs.google.com/document/d/e/2PACX-1vTEhc3TgbsBItovadXChRrcZ5VgxUtruvDC5wnEX5zxxqcFyg96q1YLRa9VdcrLuW44cM0jsbGvSSGb/pub";
    try {
      parseGoogleDocLink(published);
      throw new Error("expected a LinkError");
    } catch (error) {
      expect(error).toBeInstanceOf(LinkError);
      expect((error as LinkError).problem).toBe("published_link");
    }
    try {
      parseGoogleDocLink("https://example.com");
    } catch (error) {
      expect((error as LinkError).problem).toBe("bad_link");
    }
  });
});

describe("looksLikeGoogleDocLink", () => {
  it("is true for a pasted link of either kind, and false for a draft", () => {
    expect(looksLikeGoogleDocLink(`https://docs.google.com/document/d/${ID}/edit`)).toBe(true);
    expect(looksLikeGoogleDocLink("https://docs.google.com/document/d/e/2PACX-1vTEhc3Tgbs/pub")).toBe(true);
    expect(looksLikeGoogleDocLink("Household spending rose by 4.2 percent (Smith, 2021).")).toBe(false);
    expect(looksLikeGoogleDocLink(`See https://docs.google.com/document/d/${ID}/edit for my draft`)).toBe(false);
    expect(looksLikeGoogleDocLink("")).toBe(false);
  });
});
