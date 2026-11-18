import { describe, expect, it } from "vitest";
import { runPrelude } from "../pipeline/prelude";
import { LOCALES, MESSAGES, detectLocale, pluralKey, translate, translatorFor } from "./index";
import type { MessageKey } from "./messages";
import { localizeReason } from "./reasons";

const keys = Object.keys(MESSAGES.en) as MessageKey[];
const placeholdersOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("messages", () => {
  it("has the same keys in English and Bahasa Indonesia", () => {
    expect(Object.keys(MESSAGES.id).sort()).toEqual([...keys].sort());
  });

  it("uses the same {placeholders} in both languages, so no value goes missing in one of them", () => {
    for (const key of keys) expect(placeholdersOf(MESSAGES.id[key]), key).toEqual(placeholdersOf(MESSAGES.en[key]));
  });

  it("has no empty text, except the advice for Supported", () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        if (key === "verdict.supported.advice") continue;
        expect(MESSAGES[locale][key].trim().length, `${locale} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("has a .one and a .other for every counted message, in both languages", () => {
    for (const locale of LOCALES) {
      for (const key of keys.filter((k) => k.endsWith(".one"))) {
        expect(MESSAGES[locale][key.replace(/\.one$/, ".other") as MessageKey], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("never leaves English in the Indonesian screen text by copying it across", () => {
    // These are allowed to be the same in both: abbreviations, brand names and words that are the same in both.
    const same = new Set(["lang.en", "lang.id", "lang.enName", "lang.idName", "verdict.supported.advice", "link.placeholder"]);
    const copied = keys.filter((key) => !same.has(key) && MESSAGES.id[key] === MESSAGES.en[key]);
    expect(copied).toEqual([]);
  });
});

describe("translate", () => {
  it("fills {placeholders} and leaves an unknown one visible", () => {
    expect(translate("en", "draft.count", { n: "5", max: "60,000" })).toBe("5 / 60,000 characters");
    expect(translate("id", "draft.count", { n: "5", max: "60.000" })).toBe("5 / 60.000 karakter");
    expect(translate("en", "draft.count", { n: 1 })).toBe("1 / {max} characters");
  });

  it("picks .one or .other by count in English, and always .other in Indonesian", () => {
    expect(pluralKey("en", "tally.attention", 1)).toBe("tally.attention.one");
    expect(pluralKey("en", "tally.attention", 2)).toBe("tally.attention.other");
    expect(pluralKey("id", "tally.attention", 1)).toBe("tally.attention.other");
    expect(translatorFor("en")(pluralKey("en", "tally.attention", 1), { n: 1, total: 1 })).toBe("1 of 1 claim needs attention.");
    expect(translatorFor("id")(pluralKey("id", "tally.attention", 3), { n: 2, total: 3 })).toBe("2 dari 3 klaim perlu perhatian.");
  });
});

describe("detectLocale", () => {
  it("uses the saved choice first", () => {
    expect(detectLocale("en", ["id-ID"])).toBe("en");
    expect(detectLocale("id", ["en-US"])).toBe("id");
  });

  it("ignores a saved value that is not one of ours", () => {
    expect(detectLocale("fr", ["id-ID"])).toBe("id");
    expect(detectLocale("", [])).toBe("en");
  });

  it("follows the first language we offer in the browser's list", () => {
    expect(detectLocale(null, ["id-ID", "en-US"])).toBe("id");
    expect(detectLocale(null, ["id"])).toBe("id");
    expect(detectLocale(null, ["in"])).toBe("id"); // the old code for Indonesian
    expect(detectLocale(null, ["en-GB", "id"])).toBe("en");
    expect(detectLocale(null, ["fr-FR", "id-ID"])).toBe("id");
  });

  it("falls back to English", () => {
    expect(detectLocale(null, ["fr-FR", "de"])).toBe("en");
    expect(detectLocale(undefined, undefined)).toBe("en");
  });
});

describe("localizeReason", () => {
  const en = translatorFor("en");
  const id = translatorFor("id");
  const deps = { resolve: async () => ({ status: "not_found" as const }), findSource: async () => ({ kind: "none" as const }) };
  const entries = [{ id: "e1", position: 1, raw: "Smith, J. (2021). A study. Journal.", documentId: null }];

  /** The English reasons come from the real server code, so a change to its wording fails here. */
  async function serverReason(citation: string | null, list = entries): Promise<string> {
    const result = await runPrelude({ citation }, list, deps as never);
    if (result.outcome !== "exit") throw new Error("expected an early exit");
    return result.exit.reason;
  }

  it("leaves English exactly as the server wrote it", async () => {
    for (const reason of [
      await serverReason(null),
      await serverReason("(Brown, 2017)"),
      await serverReason("(Smith, 2021)", []),
      await serverReason("see above"),
      "No passages could be retrieved from the source.",
    ]) {
      expect(localizeReason(reason, en)).toBe(reason);
    }
  });

  it("turns the server's fixed reasons into Indonesian, keeping the student's own words in them", async () => {
    expect(localizeReason(await serverReason(null), id)).toBe("Klaim ini tidak punya sitasi.");
    expect(localizeReason(await serverReason("(Brown, 2017)"), id)).toBe('"Brown 2017" tidak ada di daftar pustaka kamu.');
    expect(localizeReason(await serverReason("(Smith, 2021)", []), id)).toContain('"Smith 2021" tidak bisa dicocokkan karena daftar pustaka belum ditambahkan.');
    expect(localizeReason(await serverReason("see above"), id)).toBe('Sitasi "see above" tidak bisa dibaca sebagai penulis dan tahun atau nomor referensi.');
    expect(localizeReason("No passages could be retrieved from the source.", id)).toBe("Tidak ada bagian yang bisa diambil dari sumber.");
  });

  it("turns the longer fixed reasons too (copied from prelude.ts)", () => {
    expect(
      localizeReason('Reference 2 ("Kementerian Keuangan...") was not found in Crossref or OpenAlex, and none of your uploaded PDFs matches it.', id),
    ).toBe('Referensi 2 ("Kementerian Keuangan...") tidak ditemukan di Crossref atau OpenAlex, dan tidak ada PDF yang kamu unggah yang cocok.');
    expect(localizeReason("The reference exists, but no uploaded source matches it. Upload the PDF to check this claim.", id)).toContain("Unggah PDF-nya");
    expect(localizeReason("The uploaded PDF for this reference has no readable text (it may be a scan). Upload a text version.", id)).toContain("hasil scan");
  });

  it("turns a retry reason, and each lookup problem inside it", () => {
    const reason = "The check could not be completed after 3 attempts: Crossref returned HTTP 429; OpenAlex could not be reached";
    expect(localizeReason(reason, id)).toBe(
      "Pengecekan belum bisa diselesaikan setelah 3 percobaan: Crossref mengembalikan HTTP 429; OpenAlex tidak terjangkau",
    );
    expect(localizeReason(reason, en)).toBe(reason);
  });

  it("returns any other reason unchanged: it is the AI's, already in the claim's language", () => {
    const aiReason = "The passage states that food prices rose by 7.1 percent in 2023.";
    expect(localizeReason(aiReason, id)).toBe(aiReason);
    expect(localizeReason("Sumber menyebut harga pangan naik 7,1 persen.", id)).toBe("Sumber menyebut harga pangan naik 7,1 persen.");
  });
});
