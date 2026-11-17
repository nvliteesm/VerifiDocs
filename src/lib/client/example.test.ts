import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { matchEntryToDocuments } from "../pipeline/find-source";
import { parseReferenceList } from "../pipeline/parse-draft";
import { EXAMPLE_DRAFT, EXAMPLE_REFERENCES, EXAMPLE_SOURCE_FILENAME, EXAMPLE_SOURCE_URL } from "./example";

const pdfPath = join(process.cwd(), "public", EXAMPLE_SOURCE_URL.replace(/^\//, ""));

describe("the example content", () => {
  it("is served from where the button fetches it, under the filename the screen uses", () => {
    expect(EXAMPLE_SOURCE_URL.endsWith(EXAMPLE_SOURCE_FILENAME)).toBe(true);
    expect(readFileSync(pdfPath).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("is a real, readable PDF that says on its first page that it is fictional", async () => {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath)));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    expect(totalPages).toBe(3);
    expect(text[0]).toMatch(/EXAMPLE DOCUMENT\. FICTIONAL/);
    // The facts the example draft is written against are in it.
    expect(text.join(" ")).toMatch(/rose by 4\.2 percent/);
    expect(text.join(" ")).toMatch(/Food prices rose by 7\.1 percent/);
    expect(text.join(" ")).toMatch(/does not measure spending on online shopping/);
  });

  it("has a reference list that parses to one entry, which the uploaded PDF matches (the rescue path)", () => {
    expect(parseReferenceList(EXAMPLE_REFERENCES)).toHaveLength(1);
    const match = matchEntryToDocuments(EXAMPLE_REFERENCES, [
      { id: "ex", status: "ready", filename: EXAMPLE_SOURCE_FILENAME, head: "" },
    ]);
    expect(match).toEqual({ kind: "found", documentId: "ex" });
  });

  it("cites the report in four sentences and a missing reference in one, so it shows a spread of verdicts", () => {
    expect(EXAMPLE_DRAFT.match(/\(Contoh Statistics Office, 2024\)/g)).toHaveLength(4);
    expect(EXAMPLE_DRAFT).toContain("(Smith, 2019)");
    expect(EXAMPLE_REFERENCES).not.toContain("Smith");
  });

  it("uses no real person, organisation or paper", () => {
    const everything = `${EXAMPLE_DRAFT} ${EXAMPLE_REFERENCES}`;
    for (const real of ["Vaswani", "Bank Indonesia", "Kemenkeu", "BPS"]) expect(everything).not.toContain(real);
  });
});
