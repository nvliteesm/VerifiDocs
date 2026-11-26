import { describe, expect, it } from "vitest";
import { discoverReference, referenceByline, referenceTitle, type DiscoverReferenceDeps } from "./discover-reference";
import type { FetchFn, ReferenceResolution } from "./resolve-reference";

const ENTRY = "Winarno, Heru, dan Rully Pujantara. 2015. “Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen ditinjau dari Karakteristik dan Kuat Tekan”. Jurnal Scientific PINISI, Vol.1, No.1, hlm. 1-6.";

/** A fake OpenAlex: answers every works query with the given results and records what was asked. */
function fakes(results: unknown[], resolution: ReferenceResolution) {
  const asked: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ results }), { status: 200 });
  };
  const deps: DiscoverReferenceDeps = { resolve: async () => resolution, fetch: fetchFn };
  return { deps, asked };
}

const found = (title: string): ReferenceResolution => ({ status: "found", resolver: "openalex", doi: "10.1/abc", title, year: 2015, yearMismatch: false });

describe("discoverReference", () => {
  it("matches an entry the resolver accepts and takes the open-access PDF link and venue from OpenAlex", async () => {
    const { deps } = fakes(
      [{ doi: "https://doi.org/10.1/abc", title: "Pengaruh komposisi bahan pengisi styrofoam", best_oa_location: { pdf_url: "https://example.org/a.pdf" }, primary_location: { source: { display_name: "Jurnal Scientific PINISI" } } }],
      found("Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen"),
    );
    const result = await discoverReference(ENTRY, deps);
    expect(result).toMatchObject({ state: "matched", type: "journal", candidate: { doi: "10.1/abc", pdfUrl: "https://example.org/a.pdf", venue: "Jurnal Scientific PINISI" } });
  });

  it("is still matched when the work has no free PDF: the link is simply absent", async () => {
    const { deps } = fakes([{ doi: "10.1/abc", title: "x", best_oa_location: null }], found("Pengaruh Komposisi Bahan Pengisi Styrofoam"));
    expect(await discoverReference(ENTRY, deps)).toMatchObject({ state: "matched", candidate: { pdfUrl: null } });
  });

  it("offers a look-alike as a possible match, never as a match", async () => {
    const { deps } = fakes(
      [{ doi: "10.2/zzz", title: "Pengaruh komposisi bahan pengisi styrofoam pada batako", publication_year: 2016, authorships: [{ author: { display_name: "Heru Winarno" } }], best_oa_location: { pdf_url: "https://example.org/b.pdf" } }],
      { status: "not_found" },
    );
    const result = await discoverReference(ENTRY, deps);
    expect(result).toMatchObject({ state: "possible", candidate: { title: "Pengaruh komposisi bahan pengisi styrofoam pada batako", year: 2016 } });
  });

  it("does not offer a work that only shares words with the publisher line, such as a university's name", async () => {
    const thesis = "Jumiati, Ety. 2021. Pembuatan Batako Konvensional dengan Pemanfaatan Limbah Kertas. Tugas Akhir. Medan: Lembaga Penelitian dan Pengabdian kepada Masyarakat, Universitas Islam Negeri Sumatera Utara Medan.";
    const { deps } = fakes([{ title: "Sistem Pelayanan Humas Universitas Islam Negeri Sumatera Utara Dalam Membangun Citra Universitas", publication_year: 2020 }], { status: "not_found" });
    expect(await discoverReference(thesis, deps)).toMatchObject({ state: "none", type: "thesis" });
  });

  it("does not offer a work that only shares a topic", async () => {
    const { deps } = fakes([{ title: "Compressive strength of concrete with recycled aggregate", publication_year: 2015 }], { status: "not_found" });
    expect(await discoverReference(ENTRY, deps)).toMatchObject({ state: "none", type: "journal" });
  });

  it("says none, not fake, for a thesis nothing indexes, and keeps its type", async () => {
    const { deps } = fakes([], { status: "not_found" });
    const thesis = "Hussein, Muhamad. 2020. Perilaku Penjual Limbah Padat Ditinjau dari Etika Bisnis Islam. Skripsi. Kediri: IAIN Kediri.";
    expect(await discoverReference(thesis, deps)).toEqual({ state: "none", type: "thesis" });
  });

  it("does not look up a law or a standard at all", async () => {
    const { deps, asked } = fakes([], { status: "not_found" });
    expect(await discoverReference("Badan Standardisasi Nasional. 1989. SNI 03-0349-1989 Bata Beton.", deps)).toEqual({ state: "none", type: "standard" });
    expect(await discoverReference("Republik Indonesia. 2002. Undang-Undang Nomor 28 Tahun 2002.", deps)).toEqual({ state: "none", type: "regulation" });
    expect(asked).toEqual([]);
  });

  it("reports a failed lookup as an error, not as none", async () => {
    const { deps } = fakes([], { status: "error", reason: "Crossref returned HTTP 429" });
    expect(await discoverReference(ENTRY, deps)).toMatchObject({ state: "error", reason: "Crossref returned HTTP 429" });
  });
});

describe("referenceTitle and referenceByline", () => {
  it("reads the quoted title of a Bahasa entry, the title after the year of an APA entry, and falls back to the start", () => {
    expect(referenceTitle(ENTRY)).toBe("Pengaruh Komposisi Bahan Pengisi Styrofoam pada Batako Mortar Semen ditinjau dari Karakteristik dan Kuat Tekan");
    expect(referenceTitle("LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.")).toBe("Deep learning");
    expect(referenceTitle("Hermanto, Dony, dkk. 2014. Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk. Skripsi. Surakarta.")).toBe("Kuat Tekan Batako Dengan Variasi Bahan Tambah Serat Ijuk");
    expect(referenceTitle("Link Slide Presentasi")).toBe("Link Slide Presentasi");
  });

  it("gives who and when for the line under the title", () => {
    expect(referenceByline("Hermanto, Dony, dkk. 2014. Kuat Tekan Batako.")).toBe("Hermanto, Dony, dkk 2014");
    expect(referenceByline("LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning.")).toBe("LeCun, Y., Bengio, Y., & Hinton, G 2015");
    expect(referenceByline("No year here")).toBe("");
  });
});
