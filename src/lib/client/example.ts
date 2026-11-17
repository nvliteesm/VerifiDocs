// The "Try an example" content. Everything here is FICTIONAL: Kota Contoh ("Example Town") and the Contoh
// Statistics Office do not exist. The source PDF (public/example/, built by scripts/make-example-pdf.mjs) says so on
// its first page. It exists so a first-time visitor can watch a full check without uploading their own files.
//
// The draft is written against that PDF so the check shows a spread of verdicts:
//   1. supported         the PDF says spending rose 4.2 percent
//   2. contradicted      the PDF says food prices ROSE 7.1 percent
//   3. partly supported  rent was the largest expense for two income groups, not every group
//   4. not in sources    the PDF says it does not measure online shopping
//   5. reference not found  "Smith, 2019" is not in the reference list
export const EXAMPLE_SOURCE_URL = "/example/Contoh-Statistics-Office-2024.pdf";
export const EXAMPLE_SOURCE_FILENAME = "Contoh-Statistics-Office-2024.pdf";

export const EXAMPLE_DRAFT =
  "Household spending in Kota Contoh rose by 4.2 percent in 2023 (Contoh Statistics Office, 2024). " +
  "Food prices fell during the same year (Contoh Statistics Office, 2024). " +
  "Rent was the largest expense for every income group (Contoh Statistics Office, 2024). " +
  "Online shopping made up a third of all household purchases (Contoh Statistics Office, 2024). " +
  "Public transport use doubled after the new bus lines opened (Smith, 2019).";

export const EXAMPLE_REFERENCES =
  "Contoh Statistics Office. (2024). Household spending and inflation in Kota Contoh, 2023. Kota Contoh: Contoh Statistics Office.";
