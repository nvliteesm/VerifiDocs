import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DraftError,
  EXTRACTION_UNIT_MAX_CHARS,
  MAX_DRAFT_CHARS,
  MAX_DOCX_BYTES,
  MAX_REFERENCES,
  parseDraft,
  parseDraftText,
  parseReferenceList,
  splitIntoUnits,
  linesAreParagraphs,
  unitParagraphs,
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

  it("splitIntoUnits reproduces the units of a parsed body, even when the body has its own References heading", () => {
    const drafts = [
      "Contents\n\nReferences\n\nBody paragraph one.\n\nReferences\n\nSmith, J. (2021). Title. Journal.",
      Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + "Word ".repeat(120).trim() + ".").join("\n\n"),
      "Plain text only.",
    ];
    for (const draft of drafts) {
      const parsed = parseDraftText(draft);
      expect(splitIntoUnits(parsed.text)).toEqual(parsed.units);
    }
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

  const list = (n: number) => Array.from({ length: n }, (_, i) => `Author${i}, A. (2020). Title number ${i}. Journal.`).join("\n\n");

  it("keeps every entry up to the limit, so a long thesis list is not cut", () => {
    expect(parseReferenceList(list(MAX_REFERENCES))).toHaveLength(MAX_REFERENCES);
  });

  it("rejects a list over the limit with a clear error instead of silently cutting it", () => {
    const attempt = () => parseReferenceList(list(MAX_REFERENCES + 1));
    expect(attempt).toThrow(DraftError);
    expect(attempt).toThrow(new RegExp(`${MAX_REFERENCES + 1} entries. The limit is ${MAX_REFERENCES}`));
    try {
      attempt();
    } catch (error) {
      expect((error as DraftError).code).toBe("too_many_references");
    }
  });
});

// A Google Docs text export: one paragraph per line, no blank lines between them (as seen on a real 176,000-character
// document, where the "References" heading was buried inside a large block and no reference list was found).
const LONG = "Physical activity among university students in Southeast Asia has fallen over the last decade, and " +
  "several national surveys report that fewer than half of students meet the recommended weekly minutes of exercise.";
const googleDoc = [
  "1. Introduction",
  LONG,
  "Most adults walk less than 5,000 steps a day [2].",
  "2. Background",
  LONG.replace("Physical", "Regular physical"),
  "11. References",
  "[1] Ward, Z. (2018). Obesity trends. The Lancet, 392, 1-10.",
  "[2] Lee, K., & Park, J. (2021). Walking and health. BMJ Open, 11, 1-8.",
].join("\n");

describe("Google Docs text (one paragraph per line)", () => {
  it("is recognised by its long lines, and hard-wrapped text is not", () => {
    expect(linesAreParagraphs(googleDoc)).toBe(true);
    const wrapped = Array.from({ length: 20 }, () => "a hard-wrapped line of about seventy characters, as a PDF gives it").join("\n");
    expect(linesAreParagraphs(wrapped)).toBe(false);
  });

  it("finds the reference list and the headings", () => {
    const parsed = parseDraftText(googleDoc);
    expect(parseReferenceList(parsed.referenceText ?? "")).toHaveLength(2);
    expect(parsed.text).not.toMatch(/Walking and health/);
    expect(parsed.sections.map((s) => s.heading)).toEqual(["1. Introduction", "2. Background"]);
  });
});

describe("unitParagraphs", () => {
  it("gives each paragraph the heading above it, even when that heading is in an earlier unit", () => {
    const parsed = parseDraftText(googleDoc);
    const first = unitParagraphs(parsed.text, 0);
    expect(first.find((p) => p.text.startsWith("Most adults"))?.heading).toBe("1. Introduction");
    expect(first.find((p) => p.text.startsWith("Regular physical"))?.heading).toBe("2. Background");

    // Push the second section into a unit of its own: its paragraphs still know their heading.
    const filler = Array.from({ length: Math.ceil(EXTRACTION_UNIT_MAX_CHARS / LONG.length) + 1 }, () => LONG).join("\n\n");
    const body = `2. Background\n\n${filler}\n\nScreen time rose sharply during the pandemic.`;
    const units = splitIntoUnits(body);
    expect(units.length).toBeGreaterThan(1);
    const last = unitParagraphs(body, units.length - 1);
    expect(last.at(-1)).toEqual({ text: "Screen time rose sharply during the pandemic.", heading: "2. Background" });
    expect(unitParagraphs(body, units.length)).toEqual([]);
  });
});

describe("sections in a document with numbered headings", () => {
  it("starts sections only at numbered headings two levels deep, not at list items or table cells", () => {
    const body = [
      "1. Introduction",
      "Shift work is common in retail.",
      "1.4. Business Model",
      "Revenue Streams",
      "Most revenue comes from subscriptions.",
      "1.4.1. Key Partners",
      "Payroll providers are partners.",
      "2. Background",
      "Up to 10 active members",
    ].join("\n\n");
    const headings = unitParagraphs(body, 0).map((p) => [p.text, p.heading]);
    expect(headings).toContainEqual(["Most revenue comes from subscriptions.", "1.4. Business Model"]);
    expect(headings).toContainEqual(["Payroll providers are partners.", "1.4. Business Model"]);
    expect(headings).toContainEqual(["Up to 10 active members", "2. Background"]);
  });

  it("keeps unnumbered headings in a document that does not number them", () => {
    const body = ["Introduction", "Shift work is common in retail.", "Background", "Most revenue comes from subscriptions."].join("\n\n");
    expect(unitParagraphs(body, 0).at(-1)).toEqual({ text: "Most revenue comes from subscriptions.", heading: "Background" });
  });
});

describe("a contents page", () => {
  it("does not take its lines for section headings, so claims are not filed under a page number", () => {
    const text = [
      "DAFTAR ISI",
      "4. Pengujian Kuat Tekan        41",
      "BAB II LANDASAN TEORI        7",
      "Kata Pengantar        iii",
      "",
      "1. Batako",
      "",
      "Batako berfungsi sebagai penahan gaya horizontal pada dinding bangunan (Darmono, 2016).",
    ].join("\n");
    const headings = parseDraftText(text).sections.map((section) => section.heading);
    expect(headings.some((heading) => /\d+$|\biii\b/.test(heading ?? ""))).toBe(false);
    expect(headings).toContain("1. Batako");
  });
});

describe("an appendix after the reference list", () => {
  const text = [
    "BAB I PENDAHULUAN",
    "Batako berfungsi sebagai penahan gaya horizontal pada dinding bangunan (Darmono, 2016).",
    "DAFTAR PUSTAKA",
    "Darmono. 2016. Teknologi Bahan Bangunan. Jakarta: Erlangga.",
    "Hermanto, Dony. 2014. Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk. Skripsi. Surakarta: UNS.",
    "LAMPIRAN",
    "Link Slide Presentasi : https://www.canva.com/design/DAFfnZ1tJmk/edit",
    "Proses Pengolahan Limbah Botol Kaca menjadi Batako",
    "Menghancurkan botol kaca menjadi serbuk yang lebih halus",
    "Hasil Batako berbahan Limbah Styrofoam",
  ].join("\n\n");

  it("ends the reference list at the appendix, so captions are not counted as references", () => {
    const parsed = parseDraftText(text);
    expect(parseReferenceList(parsed.referenceText ?? "")).toHaveLength(2);
    expect(parsed.referenceText).not.toContain("Menghancurkan");
    expect(parsed.text).not.toContain("Menghancurkan");
  });

  it("keeps the whole list when there is no appendix", () => {
    const plain = text.split("LAMPIRAN")[0]!.trim();
    expect(parseReferenceList(parseDraftText(plain).referenceText ?? "")).toHaveLength(2);
  });
});

describe("numbers that are table cells, not headings", () => {
  it("does not take a line that is only a number and a unit for a heading", () => {
    const text = ["1. Deskripsi Data", "", "Batako diuji pada hari ke-7.", "", "12.254 %", "", "7 hari", "", "Hasil pengujian menunjukkan nilai rata-rata daya serap air yang rendah pada semua batako."].join("\n\n");
    const headings = parseDraftText(text).sections.map((section) => section.heading);
    expect(headings).toContain("1. Deskripsi Data");
    expect(headings).not.toContain("12.254 %");
    expect(headings).not.toContain("7 hari");
  });
});
