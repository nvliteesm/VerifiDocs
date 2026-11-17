import { describe, expect, it } from "vitest";
import { matchEntryToDocuments } from "./find-source";

const bankEntry = "Bank Indonesia. (2024). Laporan kebijakan moneter. Jakarta: Bank Indonesia.";

const doc = (id: string, filename: string, head: string, status: "ready" | "no_text" = "ready") => ({ id, status, filename, head });

describe("matchEntryToDocuments (an uploaded PDF for an entry no online service knows)", () => {
  it("matches by filename when every filename word is in the entry, as in Bank-Indonesia-2024.pdf", () => {
    const result = matchEntryToDocuments(bankEntry, [doc("d1", "Bank-Indonesia-2024.pdf", "")]);
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("matches by the first pages when most distinctive words of the entry are printed there", () => {
    const head = "BANK INDONESIA Laporan Kebijakan Moneter Triwulan I 2024 Jakarta";
    const result = matchEntryToDocuments(bankEntry, [doc("d2", "scan0042.pdf", head)]);
    expect(result).toEqual({ kind: "found", documentId: "d2" });
  });

  it("does not match an unrelated PDF", () => {
    const result = matchEntryToDocuments(bankEntry, [
      doc("d3", "Attention-Is-All-You-Need.pdf", "Attention Is All You Need Ashish Vaswani transformer"),
    ]);
    expect(result).toEqual({ kind: "none" });
  });

  it("does not match on a single shared word", () => {
    const result = matchEntryToDocuments(bankEntry, [doc("d4", "Indonesia-tourism-guide.pdf", "Visit Indonesia beaches")]);
    expect(result).toEqual({ kind: "none" });
  });

  it("does not match on a one-word filename, which is too weak a clue", () => {
    expect(matchEntryToDocuments(bankEntry, [doc("d5", "Indonesia.pdf", "")])).toEqual({ kind: "none" });
  });

  it("prefers a readable PDF over a scan when both match equally", () => {
    const result = matchEntryToDocuments(bankEntry, [
      doc("scan", "Bank-Indonesia-2024.pdf", "", "no_text"),
      doc("text", "Bank-Indonesia-2024-2.pdf", "", "ready"),
    ]);
    expect(result).toEqual({ kind: "found", documentId: "text" });
  });

  it("reports a matching scan as no_text, so the student is told why it cannot be used", () => {
    const result = matchEntryToDocuments(bankEntry, [doc("scan", "Bank-Indonesia-2024.pdf", "", "no_text")]);
    expect(result).toEqual({ kind: "no_text", documentId: "scan" });
  });

  it("returns none when nothing was uploaded", () => {
    expect(matchEntryToDocuments(bankEntry, [])).toEqual({ kind: "none" });
  });
});
