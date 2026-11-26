import { describe, expect, it } from "vitest";
import { classifyReference, indexedOnline } from "./reference-type";

// Entries are written the way they appear in real reference lists, including the ones from the paper that prompted this.
const CASES: [string, ReturnType<typeof classifyReference>][] = [
  ["Pratama, R., & Sari, D. (2022). Pengaruh kecerdasan buatan terhadap integritas akademik mahasiswa. Jurnal Teknologi Pendidikan Nusantara, 8(2), 112-130.", "journal"],
  ["LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539", "journal"],
  ["Adreansyah, dkk. 2019. “Uji Tekan dan Daya Serap Air pada Batako”. Jurnal Sains, Teknologi, Sosial, Pendidikan, dan Bahasa, Vol. 4, No. 1, hlm. 11-14.", "journal"],
  ["Wariyatno, Nanang. 2013. “Kuat Tekan dan Kuat Tarik belah”. Dinamika Rekayasa, Vol. 9, No. 1, hlm. 23.", "journal"],
  ["Hermanto, Dony, dkk. 2014. Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk. Skripsi. Surakarta: Universitas Sebelas Maret.", "thesis"],
  ["Jumiati, Ety. 2021. Pembuatan Batako Konvensional dengan Pemanfaatan Limbah Kertas. Tugas Akhir. Medan: UIN Sumatera Utara.", "thesis"],
  ["Justin, Joshua. 2015. “Eksplorasi Limbah Kaca”. e-Proceeding of Art & Design, Vol. 2, No. 2, hlm. 908.", "proceedings"],
  ["Umar, Muhammad Zakaria, dkk. 2017. “Daya Serap Air pada Batako Beton”, Seminar Nasional Riset Kuantitatif Terapan, Vol. 1, No. 1.", "proceedings"],
  ["Darmono. 2016. Teknologi Bahan Bangunan. Jakarta: Erlangga.", "book"],
  ["Sugiyono. 2017. Metode Penelitian Kuantitatif. ISBN 978-602-289-264-7.", "book"],
  ["Republik Indonesia. 2002. Undang-Undang Nomor 28 Tahun 2002 tentang Bangunan Gedung.", "regulation"],
  ["Badan Standardisasi Nasional. 1989. SNI 03-0349-1989 Bata Beton untuk Pasangan Dinding.", "standard"],
  ["Dinas Lingkungan Hidup Kota Pontianak. 2018. Laporan Volume Sampah Kota Pontianak.", "institution"],
  ["WHO. 2019. Global report on infection prevention and control.", "institution"],
  ["Lee, K. (2020). Consumer behaviour under price pressure.", "unknown"],
];

describe("classifyReference", () => {
  for (const [raw, expected] of CASES) {
    it(`${expected}: ${raw.slice(0, 60)}`, () => {
      expect(classifyReference(raw)).toBe(expected);
    });
  }

  it("is not thrown by a journal whose name contains an institution word", () => {
    expect(classifyReference("Nugroho, A. (2020). Studi beton ringan. Jurnal Universitas Indonesia Teknik Sipil, 4(1), 1-9.")).toBe("journal");
  });
});

describe("indexedOnline", () => {
  it("is true only for a journal-style entry, so only that can ever be called not found", () => {
    expect(indexedOnline("journal")).toBe(true);
    for (const type of ["book", "thesis", "proceedings", "regulation", "standard", "institution", "unknown"] as const) {
      expect(indexedOnline(type), type).toBe(false);
    }
  });
});
