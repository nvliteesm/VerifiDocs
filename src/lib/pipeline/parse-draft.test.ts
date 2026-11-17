import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DraftError,
  EXTRACTION_UNIT_MAX_CHARS,
  MAX_DRAFT_CHARS,
  MAX_DOCX_BYTES,
  parseDraft,
  parseDraftText,
  parseReferenceList,
} from "./parse-draft";

describe("parseDraftText", () => {
  it("returns the body, sections and units for plain paragraphs", () => {
    const parsed = parseDraftText("First paragraph about rates.\n\nSecond paragraph about prices.");
    expect(parsed.text).toBe("First paragraph about rates.\n\nSecond paragraph about prices.");
    expect(parsed.sections).toEqual([
      { heading: null, text: "First paragraph about rates.\n\nSecond paragraph about prices." },
    ]);
    expect(parsed.referenceText).toBeNull();
    expect(parsed.units).toEqual([{ index: 0, text: parsed.text }]);
  });

  it("normalizes line endings and extra blank lines", () => {
    const parsed = parseDraftText("One.\r\n\r\n\r\n\r\nTwo.  \r\n");
    expect(parsed.text).toBe("One.\n\nTwo.");
  });

  it("finds markdown, numbered and short title-like headings", () => {
    const parsed = parseDraftText(
      [
        "## Introduction",
        "Rates rose in 2023.",
        "2.1 Method",
        "We surveyed 300 households.",
        "Results",
        "Spending fell.",
      ].join("\n\n"),
    );
    expect(parsed.sections.map((s) => s.heading)).toEqual(["Introduction", "2.1 Method", "Results"]);
    expect(parsed.sections[1]!.text).toBe("We surveyed 300 households.");
  });

  it("does not treat an ordinary sentence as a heading", () => {
    const parsed = parseDraftText("Inflation rose to 5 percent in 2023.\n\nHouseholds cut spending.");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.heading).toBeNull();
  });

  it("splits off a trailing reference list", () => {
    const parsed = parseDraftText(
      "Body text here.\n\nReferences\n\nSmith, J. (2021). A title. Journal.\n\nLee, K. (2020). Another. Review.",
    );
    expect(parsed.text).toBe("Body text here.");
    expect(parsed.referenceText).toBe(
      "Smith, J. (2021). A title. Journal.\n\nLee, K. (2020). Another. Review.",
    );
  });

  it("recognises Daftar Pustaka and a markdown heading", () => {
    expect(parseDraftText("Isi.\n\nDaftar Pustaka\n\nBudi (2020). Judul. Jurnal.").referenceText).toContain("Budi");
    expect(parseDraftText("Body.\n\n## References\n\nSmith (2021). Title. J.").referenceText).toContain("Smith");
  });

  it("uses the last reference heading, so a contents page is ignored", () => {
    const parsed = parseDraftText(
      "Contents\n\nReferences\n\nBody paragraph.\n\nReferences\n\nSmith, J. (2021). Title. Journal.",
    );
    expect(parsed.referenceText).toBe("Smith, J. (2021). Title. Journal.");
    expect(parsed.text).toContain("Body paragraph.");
  });

  it("keeps a reference heading with nothing under it as ordinary text", () => {
    const parsed = parseDraftText("Body.\n\nReferences");
    expect(parsed.referenceText).toBeNull();
  });

  it("rejects an empty or whitespace-only draft", () => {
    expect(() => parseDraftText("")).toThrow(DraftError);
    expect(() => parseDraftText("  \n\n \t ")).toThrow(/empty/);
  });

  it("rejects a draft over the length limit instead of cutting it", () => {
    const attempt = () => parseDraftText("a ".repeat(MAX_DRAFT_CHARS));
    expect(attempt).toThrow(DraftError);
    try {
      attempt();
    } catch (error) {
      expect((error as DraftError).code).toBe("too_long");
    }
  });

  it("cuts a long body into units within the size limit without losing text", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + "Word ".repeat(120).trim() + ".");
    const parsed = parseDraftText(paragraphs.join("\n\n"));
    expect(parsed.units.length).toBeGreaterThan(1);
    for (const unit of parsed.units) expect(unit.text.length).toBeLessThanOrEqual(EXTRACTION_UNIT_MAX_CHARS);
    expect(parsed.units.map((u) => u.index)).toEqual(parsed.units.map((_, i) => i));
    const joined = parsed.units.map((u) => u.text).join("\n\n");
    for (let i = 0; i < 40; i += 1) expect(joined).toContain(`Paragraph ${i}.`);
  });

  it("splits one huge paragraph at sentence boundaries", () => {
    const sentence = "This sentence states a fact about the economy in 2023. ";
    const parsed = parseDraftText(sentence.repeat(400));
    expect(parsed.units.length).toBeGreaterThan(1);
    for (const unit of parsed.units) {
      expect(unit.text.length).toBeLessThanOrEqual(EXTRACTION_UNIT_MAX_CHARS);
      expect(unit.text.startsWith("This sentence")).toBe(true);
    }
  });
});

describe("parseDraft (.docx)", () => {
  const fixture = readFileSync(join(process.cwd(), "tests", "fixtures", "sample.docx"));

  it("reads a .docx, separating the body from the reference list", async () => {
    const parsed = await parseDraft({ kind: "docx", buffer: fixture });
    expect(parsed.text).toContain("Inflation rose to 5 percent in 2023 (Smith, 2021).");
    expect(parsed.sections[0]!.heading).toBe("Impact of Inflation on Household Spending");
    expect(parsed.referenceText).toContain("Smith, J. (2021). Inflation and household spending.");
    expect(parsed.referenceText).toContain("Lee, K. (2020).");
  });

  it("treats pasted text the same way", async () => {
    const parsed = await parseDraft({ kind: "paste", text: "A claim (Smith, 2021)." });
    expect(parsed.units).toHaveLength(1);
  });

  it("rejects a file that is not a readable .docx", async () => {
    await expect(parseDraft({ kind: "docx", buffer: Buffer.from("not a zip file") })).rejects.toMatchObject({
      code: "docx_unreadable",
    });
  });

  it("rejects an oversized .docx before reading it", async () => {
    await expect(
      parseDraft({ kind: "docx", buffer: Buffer.alloc(MAX_DOCX_BYTES + 1) }),
    ).rejects.toMatchObject({ code: "docx_too_large" });
  });
});

describe("parseReferenceList", () => {
  it("splits entries separated by blank lines and joins wrapped lines", () => {
    const entries = parseReferenceList(
      "Smith, J. (2021). A long title that\nwraps onto a second line. Journal.\n\nLee, K. (2020). Another title. Review.",
    );
    expect(entries).toEqual([
      "Smith, J. (2021). A long title that wraps onto a second line. Journal.",
      "Lee, K. (2020). Another title. Review.",
    ]);
  });

  it("splits numbered lines and strips the numbers", () => {
    expect(
      parseReferenceList("[1] Smith, J. (2021). Title one. Journal.\n[2] Lee, K. (2020). Title two. Review."),
    ).toEqual(["Smith, J. (2021). Title one. Journal.", "Lee, K. (2020). Title two. Review."]);
    expect(parseReferenceList("1. Smith, J. (2021). Title one. J.\n2) Lee, K. (2020). Title two. R.")).toHaveLength(2);
  });

  it("keeps a numbered entry's wrapped continuation line with it", () => {
    const entries = parseReferenceList(
      "1. Smith, J. (2021). A very long title\n   that wraps. Journal.\n2. Lee, K. (2020). Short. Review.",
    );
    expect(entries).toEqual([
      "Smith, J. (2021). A very long title that wraps. Journal.",
      "Lee, K. (2020). Short. Review.",
    ]);
  });

  it("handles bullets and plain one-per-line lists", () => {
    expect(parseReferenceList("- Smith, J. (2021). Title one. J.\n- Lee, K. (2020). Title two. R.")).toHaveLength(2);
    expect(parseReferenceList("Smith, J. (2021). Title one. J.\nLee, K. (2020). Title two. R.")).toHaveLength(2);
  });

  it("drops a leading References heading and tiny junk lines", () => {
    expect(parseReferenceList("References\n\nSmith, J. (2021). Title one. J.\n\n12")).toEqual([
      "Smith, J. (2021). Title one. J.",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseReferenceList("")).toEqual([]);
    expect(parseReferenceList("  \n ")).toEqual([]);
    expect(parseReferenceList("References")).toEqual([]);
  });

  it("caps the number of entries", () => {
    const many = Array.from({ length: 300 }, (_, i) => `Author${i}, A. (2020). Title number ${i}. Journal.`).join("\n\n");
    expect(parseReferenceList(many)).toHaveLength(200);
  });
});
