import { describe, expect, it } from "vitest";
import { markDifferences } from "./numbers";

const marked = (pieces: { text: string; marked: boolean }[]) => pieces.filter((piece) => piece.marked).map((piece) => piece.text);

describe("markDifferences", () => {
  it("marks the claim's number and the quote's different number", () => {
    const result = markDifferences("Prices rose by 4.2 percent in 2023", null, "Prices rose by 7.1 percent in 2023.");
    expect(result.any).toBe(true);
    expect(marked(result.claim)).toEqual(["4.2"]);
    expect(marked(result.quote)).toEqual(["7.1"]);
  });

  it("keeps the whole text when the pieces are joined", () => {
    const claim = "Prices rose by 4.2 percent in 2023";
    const quote = "Prices rose by 7.1 percent in 2023.";
    const result = markDifferences(claim, null, quote);
    expect(result.claim.map((piece) => piece.text).join("")).toBe(claim);
    expect(result.quote.map((piece) => piece.text).join("")).toBe(quote);
  });

  it("marks nothing when every number of the claim is in the quote, even if the quote has more", () => {
    const result = markDifferences("Spending rose by 4.2 percent", null, "Spending rose by 4.2 percent; food rose by 7.1 percent.");
    expect(result.any).toBe(false);
    expect(marked(result.claim)).toEqual([]);
    expect(marked(result.quote)).toEqual([]);
  });

  it("treats a decimal comma and a decimal point alike, and ignores thousands separators", () => {
    expect(markDifferences("Naik 0,001 persen", null, "Naik 0.001 persen").any).toBe(false);
    expect(markDifferences("There were 1,200 cases", null, "There were 1200 cases").any).toBe(false);
  });

  it("keeps 81 and 81.5 different", () => {
    expect(markDifferences("It was 81 percent", null, "It was 81.5 percent").any).toBe(true);
  });

  it("does not count the citation's year as a claim number", () => {
    expect(markDifferences("Prices rose (Smith, 2019)", "(Smith, 2019)", "Prices rose a lot.").any).toBe(false);
    expect(markDifferences("Prices rose (Smith, 2019)", null, "Prices rose a lot.").any).toBe(false);
  });

  it("marks nothing when the claim states no number", () => {
    expect(markDifferences("Food prices fell", null, "Food prices rose by 7.1 percent.").any).toBe(false);
  });
});
