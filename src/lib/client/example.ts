// The "Try an example" content, in English and in Bahasa Indonesia. Everything here is FICTIONAL: Kota Contoh
// ("Example Town"), the Contoh Statistics Office and the Badan Statistik Contoh do not exist. Each source PDF
// (public/example/, built by scripts/make-example-pdf.mjs) says so on its first page. It exists so a first-time
// visitor can watch a full check without uploading their own files.
//
// Each draft is written against its PDF so the check shows a spread of verdicts:
//   1. supported         the PDF says spending rose 4.2 percent
//   2. contradicted      the PDF says food prices ROSE 7.1 percent
//   3. partly supported  rent was the largest expense for two income groups, not every group
//   4. not in sources    the PDF says it does not measure online shopping
//   5. reference not found  "Smith, 2019" is not in the reference list
import type { Locale } from "../i18n";

export interface ExampleContent {
  sourceUrl: string;
  sourceFilename: string;
  draft: string;
  references: string;
}

const ENGLISH: ExampleContent = {
  sourceUrl: "/example/Contoh-Statistics-Office-2024.pdf",
  sourceFilename: "Contoh-Statistics-Office-2024.pdf",
  draft:
    "Household spending in Kota Contoh rose by 4.2 percent in 2023 (Contoh Statistics Office, 2024). " +
    "Food prices fell during the same year (Contoh Statistics Office, 2024). " +
    "Rent was the largest expense for every income group (Contoh Statistics Office, 2024). " +
    "Online shopping made up a third of all household purchases (Contoh Statistics Office, 2024). " +
    "Public transport use doubled after the new bus lines opened (Smith, 2019).",
  references:
    "Contoh Statistics Office. (2024). Household spending and inflation in Kota Contoh, 2023. Kota Contoh: Contoh Statistics Office.",
};

const INDONESIAN: ExampleContent = {
  sourceUrl: "/example/Badan-Statistik-Contoh-2024.pdf",
  sourceFilename: "Badan-Statistik-Contoh-2024.pdf",
  draft:
    "Pengeluaran rumah tangga di Kota Contoh naik 4,2 persen pada 2023 (Badan Statistik Contoh, 2024). " +
    "Harga pangan turun pada tahun yang sama (Badan Statistik Contoh, 2024). " +
    "Biaya sewa adalah pengeluaran terbesar bagi semua kelompok pendapatan (Badan Statistik Contoh, 2024). " +
    "Belanja daring mencakup sepertiga dari seluruh pembelian rumah tangga (Badan Statistik Contoh, 2024). " +
    "Penggunaan transportasi umum meningkat dua kali lipat setelah jalur bus baru dibuka (Smith, 2019).",
  references:
    "Badan Statistik Contoh. (2024). Pengeluaran rumah tangga dan inflasi di Kota Contoh, 2023. Kota Contoh: Badan Statistik Contoh.",
};

export const EXAMPLES: Record<Locale, ExampleContent> = { en: ENGLISH, id: INDONESIAN };

/** The example that matches the screen's language. */
export function exampleFor(locale: Locale): ExampleContent {
  return EXAMPLES[locale];
}

// The English example, under the names used before there was a second language.
export const EXAMPLE_SOURCE_URL = ENGLISH.sourceUrl;
export const EXAMPLE_SOURCE_FILENAME = ENGLISH.sourceFilename;
export const EXAMPLE_DRAFT = ENGLISH.draft;
export const EXAMPLE_REFERENCES = ENGLISH.references;
