// Builds the example source PDFs used by the "Try an example" button: node scripts/make-example-pdf.mjs
//
// Two reports, one English and one Bahasa Indonesia. Both are FICTIONAL. "Kota Contoh" ("Example Town"), the
// "Contoh Statistics Office" and the "Badan Statistik Contoh" do not exist, and every number is made up so that a
// first-time visitor can see a full check without uploading their own files. The first page of each says so in plain
// words. The numbers are chosen so the example drafts (src/lib/client/example.ts) produce a spread of verdicts:
// supported, contradicted, partly supported, not in the sources.
// The PDFs are written by hand (no dependency): a few Helvetica text pages with correct cross-reference offsets.
// Both reports use only plain ASCII letters, so the built-in font can show them.
import { mkdirSync, writeFileSync } from "node:fs";

const documents = [
  {
    file: "Contoh-Statistics-Office-2024.pdf",
    pages: [
      [
        "EXAMPLE DOCUMENT. FICTIONAL. Made up for demonstration only.",
        "",
        "Household Spending and Inflation in Kota Contoh, 2023",
        "Contoh Statistics Office, 2024",
        "",
        "Summary",
        "Household spending in Kota Contoh rose by 4.2 percent in 2023, compared with 2022.",
        "Inflation averaged 5.6 percent over the year.",
      ],
      [
        "Prices",
        "Food prices rose by 7.1 percent in 2023, the fastest increase of any category.",
        "Transport prices rose by 3.4 percent.",
        "",
        "Rent",
        "Rent was the largest household expense for the lowest and middle income groups,",
        "at 31 percent and 27 percent of spending. For the highest income group, transport",
        "was the largest expense, at 24 percent of spending.",
      ],
      [
        "Method",
        "The survey covered 2,400 households. Figures are annual averages.",
        "",
        "Limits",
        "The survey does not measure spending on online shopping.",
      ],
    ],
  },
  {
    file: "Badan-Statistik-Contoh-2024.pdf",
    pages: [
      [
        "DOKUMEN CONTOH. FIKTIF. Dibuat hanya untuk demonstrasi.",
        "",
        "Pengeluaran Rumah Tangga dan Inflasi di Kota Contoh, 2023",
        "Badan Statistik Contoh, 2024",
        "",
        "Ringkasan",
        "Pengeluaran rumah tangga di Kota Contoh naik 4,2 persen pada 2023 dibandingkan 2022.",
        "Inflasi rata-rata 5,6 persen sepanjang tahun.",
      ],
      [
        "Harga",
        "Harga pangan naik 7,1 persen pada 2023, kenaikan tercepat dari semua kategori.",
        "Harga transportasi naik 3,4 persen.",
        "",
        "Sewa",
        "Biaya sewa adalah pengeluaran rumah tangga terbesar bagi kelompok pendapatan",
        "terendah dan menengah, yaitu 31 persen dan 27 persen dari pengeluaran. Bagi",
        "kelompok pendapatan tertinggi, transportasi adalah pengeluaran terbesar, yaitu",
        "24 persen dari pengeluaran.",
      ],
      [
        "Metode",
        "Survei mencakup 2.400 rumah tangga. Angka adalah rata-rata tahunan.",
        "",
        "Keterbatasan",
        "Survei ini tidak mengukur pengeluaran untuk belanja daring.",
      ],
    ],
  },
];

const escape = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function content(lines) {
  const body = ["BT", "/F1 12 Tf", "72 720 Td", "18 TL"];
  for (const line of lines) body.push(`(${escape(line)}) Tj T*`);
  body.push("ET");
  return body.join("\n");
}

function buildPdf(pages) {
  // Objects: 1 catalog, 2 pages, 3 font, then a page and its content stream per page.
  const objects = [];
  const add = (text) => objects.push(text) && objects.length;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pages.map((_, i) => 4 + i * 2);
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  for (const lines of pages) {
    const id = objects.length + 1;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const stream = content(lines);
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

mkdirSync("public/example", { recursive: true });
for (const { file, pages } of documents) {
  const pdf = buildPdf(pages);
  writeFileSync(`public/example/${file}`, pdf, "latin1");
  console.log(`wrote public/example/${file} (${Buffer.byteLength(pdf)} bytes, ${pages.length} pages)`);
}
