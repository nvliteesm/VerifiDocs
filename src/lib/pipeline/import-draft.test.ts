import { describe, expect, it } from "vitest";
import { IngestError } from "./ingest";
import {
  ImportError,
  fetchGoogleDocText,
  normalizeImportedText,
  readPdfDraft,
} from "./import-draft";
import { parseDraftText, parseReferenceList } from "./parse-draft";

const ID = "1zNfrhNd-YvYB6stWLrujUCABad9c6EQcCdJWlmdfMe8";
const LINK = `https://docs.google.com/document/d/${ID}/edit?usp=sharing`;
const EXPORT = `https://docs.google.com/document/d/${ID}/export?format=txt`;
const GOOGLE_HOST = "https://doc-0o-98-docstext.googleusercontent.com/export/abc/def/1794973125000/1131/*/" + ID + "?format=txt";

/** A fake `fetch`: each call takes the next scripted answer and records the address it was asked for. */
function fakeFetch(answers: (Response | Error)[]) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    asked.push({ url: String(input), init });
    const next = answers.shift();
    if (!next) throw new Error("no more scripted answers");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, asked };
}
const redirect = (to: string) => new Response(null, { status: 307, headers: { location: to } });
const text = (body: string, type = "text/plain; charset=utf-8", status = 200) =>
  new Response(body, { status, headers: { "content-type": type } });
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "no error";
  } catch (error) {
    return error instanceof ImportError ? error.code : `other: ${String(error)}`;
  }
};

describe("fetchGoogleDocText", () => {
  it("builds the export address from the id alone and follows Google's own redirect to the text", async () => {
    const { fetchImpl, asked } = fakeFetch([redirect(GOOGLE_HOST), text("﻿Hello world\r\n")]);
    // The byte-order mark is dropped when the bytes are decoded; normalizeImportedText drops it from text that has one.
    expect(await fetchGoogleDocText(LINK, { fetchImpl })).toBe("Hello world\r\n");
    expect(asked.map((call) => call.url)).toEqual([EXPORT, GOOGLE_HOST]);
    expect(asked.every((call) => call.init?.redirect === "manual")).toBe(true); // redirects are checked, not followed
  });

  it("never sends the student's own link, only an address built from the id", async () => {
    const { fetchImpl, asked } = fakeFetch([text("ok")]);
    await fetchGoogleDocText(`${LINK}&secret=token#fragment`, { fetchImpl });
    expect(asked[0]!.url).toBe(EXPORT);
  });

  it("treats a redirect to a sign-in page, or to any other host, as 'not public'", async () => {
    for (const to of [
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdocs.google.com",
      "https://evil.example/steal",
      "http://doc-0o-98-docstext.googleusercontent.com/x", // not https
      "https://doc-0o-98-docstext.googleusercontent.com.evil.example/x",
      "https://user:pw@docs.google.com/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/",
    ]) {
      const { fetchImpl, asked } = fakeFetch([redirect(to), text("should never be fetched")]);
      expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl })), to).toBe("not_public");
      expect(asked).toHaveLength(1); // it stopped at the redirect
    }
  });

  it("does not follow a long chain of redirects", async () => {
    const { fetchImpl } = fakeFetch([1, 2, 3, 4, 5].map(() => redirect("https://docs.google.com/document/d/x")));
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl }))).toBe("import_failed");
  });

  it("explains a document that is missing, private, or answered with a web page", async () => {
    for (const status of [401, 403, 404, 410]) {
      const { fetchImpl } = fakeFetch([text("<html>nope</html>", "text/html", status)]);
      expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl })), String(status)).toBe("not_public");
    }
    const html = fakeFetch([text("<html>Sign in</html>", "text/html; charset=utf-8", 200)]);
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: html.fetchImpl }))).toBe("not_public");
  });

  it("tells a busy Google from a failure", async () => {
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([text("", "text/plain", 429)]).fetchImpl }))).toBe("import_busy");
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([text("", "text/plain", 500)]).fetchImpl }))).toBe("import_failed");
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([new TypeError("fetch failed")]).fetchImpl }))).toBe("import_failed");
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([timedOut]).fetchImpl }))).toBe("import_failed");
  });

  it("refuses a document over the size limit, by its declared size and by what it actually sends", async () => {
    const declared = new Response("x", { status: 200, headers: { "content-type": "text/plain", "content-length": "5000000" } });
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([declared]).fetchImpl, maxBytes: 1_000 }))).toBe("too_large");
    const streamed = text("a".repeat(5_000));
    expect(await codeOf(fetchGoogleDocText(LINK, { fetchImpl: fakeFetch([streamed]).fetchImpl, maxBytes: 1_000 }))).toBe("too_large");
  });

  it("refuses a bad link and a Publish to web link before any request is made", async () => {
    const { fetchImpl, asked } = fakeFetch([]);
    expect(await codeOf(fetchGoogleDocText("https://example.com/x", { fetchImpl }))).toBe("bad_link");
    expect(await codeOf(fetchGoogleDocText("https://docs.google.com/document/d/e/2PACX-1vTEhc3TgbsBItovadXChRrcZ5VgxUtruvDC5wnEX5zxxqcFyg96q1YLRa9VdcrLuW44cM0jsbGvSSGb/pub", { fetchImpl }))).toBe("published_link");
    expect(asked).toHaveLength(0);
  });
});

describe("normalizeImportedText", () => {
  it("removes the byte-order mark, Windows line endings, indentation and extra blank lines", () => {
    const raw = "﻿Rubric\r\n\r\n\r\n\r\n   Item  \r\n\tPoint Value\r\nBody text.\r\n";
    const { text, warnings } = normalizeImportedText(raw);
    expect(text).toBe("Rubric\n\nItem\nPoint Value\nBody text.");
    expect(warnings).toEqual([]);
  });

  it("warns about a table, which Google writes as one cell per line starting with a tab", () => {
    const raw = "Results\n\n\tItem\n\tPoint Value\n\tYour Score\n\tAn argument\n\t25\n\t15\n";
    const { text, warnings } = normalizeImportedText(raw);
    expect(warnings).toEqual(["tables"]);
    expect(text).toContain("An argument\n25\n15");
    expect(text).not.toContain("\t");
  });

  it("does not warn about a single tab", () => {
    expect(normalizeImportedText("One\tcolumn\n").warnings).toEqual([]);
  });

  it("does not call a few stray tab-led lines a table (a long outline with page-break tabs, as in a real document)", () => {
    const outline = Array.from({ length: 150 }, (_, i) => (i % 20 === 0 ? `\t${i}. Part heading` : `* point number ${i}`)).join("\r\n");
    expect(normalizeImportedText(outline).warnings).toEqual([]);
  });

  it("removes the footnote block and its [n] markers, so [1] is not mistaken for reference 1", () => {
    const raw =
      "The press opened in 1891.[1] It grew.[2] See [3] for more and a list [4] that is not a footnote.\r\n\r\n" +
      "________________\r\n[1]The University of Chicago. About. 2017.\r\n[2]Turabian, A Manual, xiii.\r\n[3]Purdue OWL.\r\nhttps://owl.purdue.edu/x.\r\n";
    const { text, warnings } = normalizeImportedText(raw);
    expect(warnings).toEqual(["footnotes"]);
    expect(text).toBe("The press opened in 1891. It grew. See  for more and a list [4] that is not a footnote.");
    expect(text).not.toContain("University of Chicago");
    expect(text).not.toContain("owl.purdue");
  });

  it("keeps [1] markers when there is no footnote block (a numbered reference style)", () => {
    const raw = "Spending rose [1]. Prices fell [2].\n\nReferences\n[1] Smith, J. (2021). A study.\n[2] Lee, K. (2020). Another.";
    const { text, warnings } = normalizeImportedText(raw);
    expect(warnings).toEqual([]);
    expect(text).toContain("rose [1]");
    expect(text).toContain("[2] Lee, K. (2020)");
  });

  it("keeps a line of underscores that is not followed by notes", () => {
    const raw = "Name: ________\n________________\nSigned by the author.";
    expect(normalizeImportedText(raw).text).toContain("Signed by the author.");
  });

  it("gives text the draft parser can split into a body and a reference list", () => {
    const raw =
      "﻿Household spending rose by 4.2 percent (Contoh Statistics Office, 2024).\r\n\r\nReferences\r\n\r\n" +
      "Contoh Statistics Office. (2024). Household spending and inflation in Kota Contoh, 2023.\r\n";
    const parsed = parseDraftText(normalizeImportedText(raw).text);
    expect(parsed.text).toBe("Household spending rose by 4.2 percent (Contoh Statistics Office, 2024).");
    expect(parseReferenceList(parsed.referenceText ?? "")).toHaveLength(1);
  });
});

// A tiny text PDF, written by hand like scripts/make-example-pdf.mjs: a Helvetica page per array of lines.
function makePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  for (const lines of pages) {
    const id = objects.length + 1;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const stream = ["BT", "/F1 10 Tf", "40 740 Td", "14 TL", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("readPdfDraft", () => {
  const pdf = makePdf([
    [
      "Pendahuluan",
      "Pengeluaran rumah tangga di Kota Contoh naik 4,2 persen pada 2023 menurut laporan resmi yang",
      "diterbitkan oleh badan statistik setempat (Badan Statistik Contoh, 2024). Angka ini lebih tinggi",
      "dari tahun sebelumnya.",
      "Daftar Pustaka",
      "Badan Statistik Contoh. (2024). Pengeluaran rumah tangga dan inflasi di Kota Contoh, 2023. Kota",
      "Contoh: Badan Statistik Contoh.",
      "Lee, K. (2020). Another study of household budgets in some other town, with a long title that wraps",
      "to a second line.",
    ],
  ]);

  it("rebuilds paragraphs from the wrapped lines, keeps the headings apart and keeps the student's capital letters", async () => {
    const text = await readPdfDraft(pdf);
    const paragraphs = text.split("\n\n");
    expect(paragraphs[0]).toBe("Pendahuluan");
    expect(paragraphs[1]).toBe(
      "Pengeluaran rumah tangga di Kota Contoh naik 4,2 persen pada 2023 menurut laporan resmi yang diterbitkan oleh badan statistik setempat (Badan Statistik Contoh, 2024). Angka ini lebih tinggi dari tahun sebelumnya.",
    );
    expect(paragraphs[2]).toBe("Daftar Pustaka");
  });

  it("gives text the draft parser splits into a body and one reference per entry", async () => {
    const parsed = parseDraftText(await readPdfDraft(pdf));
    expect(parsed.text).toContain("Pengeluaran rumah tangga");
    expect(parsed.text).not.toContain("Daftar Pustaka");
    expect(parseReferenceList(parsed.referenceText ?? "")).toEqual([
      "Badan Statistik Contoh. (2024). Pengeluaran rumah tangga dan inflasi di Kota Contoh, 2023. Kota Contoh: Badan Statistik Contoh.",
      "Lee, K. (2020). Another study of household budgets in some other town, with a long title that wraps to a second line.",
    ]);
  });

  it("refuses a PDF with no text (a scan), a file that is not a PDF, and a damaged PDF", async () => {
    expect(await codeOf(readPdfDraft(makePdf([[]])))).toBe("import_empty");
    await expect(readPdfDraft(new TextEncoder().encode("just some text, not a pdf"))).rejects.toMatchObject({ code: "not_a_pdf" });
    await expect(readPdfDraft(new TextEncoder().encode("%PDF-1.4\nthis is broken"))).rejects.toBeInstanceOf(IngestError);
  });
});
