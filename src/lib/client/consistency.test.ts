import { describe, expect, it } from "vitest";
import { canonicalValue, findInconsistencies, type FigureOccurrence } from "./consistency";

let n = 0;
function fig(label: string, value: string, unit: string | null, extra: Partial<FigureOccurrence> = {}): FigureOccurrence {
  n += 1;
  return { label, value, unit, sentence: `Sentence number ${n} reports the value ${value} for this quantity.`, section: null, part: n, ...extra };
}

describe("canonicalValue", () => {
  it("reads the same number written two ways as one", () => {
    expect(canonicalValue("1,893 %").text).toBe(canonicalValue("1.893").text);
    expect(canonicalValue("216,10").digits).toBe("21610");
  });
  it("keeps a date as normalised text", () => {
    expect(canonicalValue("5 Maret 2021")).toEqual({ text: "5 maret 2021", digits: null });
  });
});

describe("findInconsistencies", () => {
  it("reports the same figure written 1,893% in the table and 1,839% in the discussion and conclusion, naming every place", () => {
    const table = fig("Daya serap air rata-rata batako daun ketapang kering", "1,893", "%", { section: "Tabel 4.5", part: 1 });
    const discussion = fig("Daya serap air batako daun ketapang kering", "1,839", "%", { section: "Pembahasan", part: 2 });
    const conclusion = fig("Daya serap air batako daun ketapang kering", "1,839", "%", { section: "Kesimpulan", part: 3 });
    const found = findInconsistencies([table, discussion, conclusion]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "value", label: "Daya serap air batako daun ketapang kering" });
    expect(found[0]!.places.map((p) => [p.section, p.value])).toEqual([["Tabel 4.5", "1,893"], ["Pembahasan", "1,839"], ["Kesimpulan", "1,839"]]);
  });

  it("reports a different count for the same quantity when the labels match closely", () => {
    const methods = fig("Jumlah responden survei", "500", "responden", { part: 1 });
    const results = fig("Jumlah responden survei", "300", "responden", { part: 2 });
    expect(findInconsistencies([methods, results])).toHaveLength(1);
  });

  it("does not report the same value, however it is written", () => {
    expect(findInconsistencies([fig("Daya serap air batako kaca", "4,166", "%"), fig("Daya serap air batako kaca", "4.166 %", "%")])).toEqual([]);
  });

  it("does not report a different condition just because the numbers differ", () => {
    const day7 = fig("Daya serap air batako styrofoam hari 7", "10,294", "%");
    const day14 = fig("Daya serap air batako styrofoam hari 14", "13,235", "%");
    expect(findInconsistencies([day7, day14])).toEqual([]);
  });

  it("does not report different materials with the same measure", () => {
    expect(findInconsistencies([fig("Kuat tekan batako botol kaca", "216,10", "kg/cm2"), fig("Kuat tekan batako pasir", "57,14", "kg/cm2")])).toEqual([]);
  });

  it("reports a slip between loosely matching labels, but not unrelated labels", () => {
    // Loosely matching labels (about 70% of the words): only a slip of a digit or two is reported.
    const a = fig("Daya serap air batako daun", "2,820", "%");
    const b = fig("Daya serap air batako daun ketapang kering", "2,802", "%");
    expect(findInconsistencies([a, b])).toHaveLength(1);
    expect(findInconsistencies([a, fig("Daya serap air batako daun ketapang kering", "9,500", "%")])).toEqual([]);
    expect(findInconsistencies([fig("Massa kering batako kaca", "1.200", "gram"), fig("Umur batako uji", "1.201", "hari")])).toEqual([]);
  });

  it("reports the same number with different units, and says it is a unit difference", () => {
    const found = findInconsistencies([fig("Kuat tekan batako daun kering", "59,18", "kg/cm2"), fig("Kuat tekan batako daun kering", "59,18", "MPa")]);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe("unit");
  });

  it("ignores two figures from the same sentence", () => {
    const sentence = "Batako kaca menyerap air 4,166% dan batako kaca menyerap air 4,116% pada hari ketujuh.";
    expect(findInconsistencies([fig("Daya serap air batako kaca", "4,166", "%", { sentence }), fig("Daya serap air batako kaca", "4,116", "%", { sentence })])).toEqual([]);
  });

  it("does not turn a chain of look-alike labels into one finding that lists unrelated numbers", () => {
    const found = findInconsistencies([fig("Jumlah sampel uji batako", "400", null), fig("Jumlah sampel uji batako", "575", null), fig("Jumlah sampel uji batako", "900", null)]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.places.length === 2)).toBe(true);
  });

  it("joins slips of one figure into one finding, and lists the finding with more places first", () => {
    const three = [fig("Daya serap air batako daun", "1.893", "%"), fig("Daya serap air batako daun", "1.839", "%"), fig("Daya serap air batako daun", "1.389", "%")];
    const two = [fig("Tahun pelaksanaan percobaan batako", "2022", null), fig("Tahun pelaksanaan percobaan batako", "2023", null)];
    expect(findInconsistencies([...two, ...three]).map((f) => f.places.length)).toEqual([3, 2]);
  });

  it("does not report table cells, small whole numbers such as days, or different units for different things", () => {
    // The vague labels the model gives table cells made 7, 14 and 21 days, and a list of masses, look like one quantity.
    const cells = ["7", "14", "21"].map((day) => fig("Hari pengujian batako berbahan botol kaca", day, "hari", { sentence: day }));
    const masses = ["1.200", "1.250", "1.450"].map((mass) => fig("Umur batako berbahan botol kaca", mass, "gram", { sentence: mass }));
    expect(findInconsistencies([...cells, ...masses])).toEqual([]);
    const days = [fig("Hari pengujian batako berbahan botol kaca", "7", "hari"), fig("Hari pengujian batako berbahan botol kaca", "14", "hari")];
    expect(findInconsistencies(days)).toEqual([]);
  });

  it("does not mistake two different days of one material for a slip", () => {
    // 1,839 (average) and 1,379 (day 7) are far apart: more than one digit differs, and they are not swapped neighbours.
    expect(findInconsistencies([fig("Daya serap air batako daun ketapang kering", "1,839", "%"), fig("Daya serap air batako daun ketapang kering", "1,379", "%")])).toEqual([]);
  });

  it("caps the list, so a student gets findings to act on and not a wall", () => {
    const many = Array.from({ length: 20 }, (_, i) => [fig(`Besaran khusus nomor ${i} batako`, `${i + 100}0`, "kg"), fig(`Besaran khusus nomor ${i} batako`, `${i + 100}1`, "kg")]).flat();
    expect(findInconsistencies(many).length).toBeLessThanOrEqual(12);
  });

  it("is empty for no figures", () => {
    expect(findInconsistencies([])).toEqual([]);
  });
});

describe("places that are next to each other", () => {
  it("does not report two figures in the same part and section as one quantity, such as the dry and the wet mass", () => {
    const dry = fig("Massa batako daun kering", "1.450", "gram", { part: 4, section: "1. Deskripsi Data" });
    const wet = fig("Massa batako daun kering", "1.470", "gram", { part: 4, section: "1. Deskripsi Data" });
    expect(findInconsistencies([dry, wet])).toEqual([]);
  });

  it("does report the same slip when the two places are far apart, such as the table and the conclusion", () => {
    const table = fig("Daya serap air batako daun ketapang kering", "1,893", "%", { part: 4, section: "1. Deskripsi Data" });
    const conclusion = fig("Daya serap air batako daun ketapang kering", "1,839", "%", { part: 12, section: "1. Kesimpulan" });
    expect(findInconsistencies([table, conclusion])).toHaveLength(1);
  });
});

describe("table cells", () => {
  it("does not call a bare table cell a slip of a nearby sentence, because the label the model gave the cell is a guess", () => {
    const cell = fig("Massa basah batako styrofoam hari ke-7", "770", "gram", { sentence: "770", part: 3, section: "1. Deskripsi Data" });
    const prose = fig("Massa basah batako styrofoam hari ke-7", "750", "gram", { sentence: "Pada hari ke-7 massa basah batako styrofoam adalah 750 gram menurut tabel.", part: 5, section: "1. Deskripsi Data" });
    expect(findInconsistencies([cell, prose])).toEqual([]);
  });
});
