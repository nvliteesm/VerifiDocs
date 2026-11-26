import { describe, expect, it } from "vitest";
import { tableCaptionOf, tablesAsRows } from "./table-rows";

const TABLE_41 = [
  "Hasil pengujian ditunjukkan pada tabel berikut.",
  "Tabel 4.1 Hasil Pengujian Daya Serap Air pada Batako Berbahan Botol Kaca",
  "Umur",
  "(hari)",
  "\tUkuran (cm²)",
  "\tMassa Kering (gram)",
  "\tMassa Basah",
  "(gram)",
  "\tDaya Serap Air",
  "\t7",
  "\t135",
  "\t1.200",
  "\t1.250",
  "\t4,166 %",
  "\t14",
  "\t135",
  "\t1.200",
  "\t1.260",
  "\t5,000 %",
  "\tTotal Rata - Rata",
  "\t4,583 %",
  "",
  "Daya serap rata-rata batako botol kaca adalah 4,583 %.",
].join("\r\n");

describe("tablesAsRows", () => {
  const out = tablesAsRows(TABLE_41).split("\n");

  it("keeps the caption and the text around the table", () => {
    expect(out[0]).toBe("Hasil pengujian ditunjukkan pada tabel berikut.");
    expect(out[1]).toBe("Tabel 4.1 Hasil Pengujian Daya Serap Air pada Batako Berbahan Botol Kaca");
    expect(out.at(-1)).toBe("Daya serap rata-rata batako botol kaca adalah 4,583 %.");
  });

  it("writes each row with its column headings, joining two-line headings", () => {
    expect(out[2]).toBe("[Tabel 4.1 Hasil Pengujian Daya Serap Air pada Batako Berbahan Botol Kaca] Umur (hari) = 7; Ukuran (cm²) = 135; Massa Kering (gram) = 1.200; Massa Basah (gram) = 1.250; Daya Serap Air = 4,166 %");
    expect(out[3]).toContain("Umur (hari) = 14");
    expect(out[3]).toContain("Daya Serap Air = 5,000 %");
  });

  it("puts a short total row's cells under the last headings", () => {
    expect(out[4]).toBe("[Tabel 4.1 Hasil Pengujian Daya Serap Air pada Batako Berbahan Botol Kaca] Total Rata - Rata; Daya Serap Air = 4,583 %");
  });

  it("leaves a contents-page line and plain text unchanged", () => {
    const text = "Tabel 2.1 Unsur Semen Portland        12\nTabel 2.2 Syarat Fisis Batako Pejal        18\n\nIsi bab satu.";
    expect(tablesAsRows(text)).toBe(text);
  });

  it("reads a table whose first column is a label, and leaves a schedule of months alone", () => {
    const labelled = "Tabel 4.7 Perbandingan\nNo.\n\tBahan\n\tKuat Tekan\n\t1\n\tBotol Kaca\n\t216,10\n\t2\n\tPasir\n\t57,14";
    expect(tablesAsRows(labelled).split("\n")[1]).toBe("[Tabel 4.7 Perbandingan] No. = 1; Bahan = Botol Kaca; Kuat Tekan = 216,10");
    const schedule = "Tabel 3.1 Waktu\nKegiatan\n\tJanuari\n\tFebruari\n\t1\n\t2\n\t3\n\t4\n\t1\n\t2";
    expect(tablesAsRows(schedule)).toBe(schedule);
  });

  it("stops at a paragraph that follows the last cell", () => {
    const text = "Tabel 4.1 Hasil\nUmur\n\tDaya\n\t7\n\t4,1 %\n\t14\n\t5,0 %\n\tBerdasarkan tabel 4.1 menunjukkan hasil pengujian daya serap air pada batako berbahan botol kaca.";
    expect(tablesAsRows(text).split("\n").at(-1)).toContain("Berdasarkan tabel 4.1");
  });

  it("leaves a table it cannot read unchanged", () => {
    const text = "Tabel 3.1 Waktu Penelitian\nKegiatan\n\tJanuari\n\tFebruari";
    expect(tablesAsRows(text)).toBe(text);
  });
});

describe("tableCaptionOf", () => {
  it("reads the caption from a rebuilt row and from nothing else", () => {
    expect(tableCaptionOf("[Tabel 4.6 Hasil Kuat Tekan] Umur = 7")).toBe("Tabel 4.6 Hasil Kuat Tekan");
    expect(tableCaptionOf("Daya serap rata-rata adalah 4,583 %.")).toBeNull();
  });
});
