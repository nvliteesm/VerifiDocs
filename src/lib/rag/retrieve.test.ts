import { describe, expect, it } from "vitest";
import { buildTsQuery } from "./retrieve";

describe("buildTsQuery", () => {
  it("lowercases, drops stopwords and joins content words with OR", () => {
    expect(buildTsQuery("The central bank raised the interest rate")).toBe(
      "central | bank | raised | interest | rate",
    );
  });

  it("drops Bahasa Indonesia stopwords", () => {
    expect(buildTsQuery("Tingkat inflasi yang dilaporkan di Indonesia")).toBe(
      "tingkat | inflasi | dilaporkan | indonesia",
    );
  });

  it("keeps numbers, including short ones", () => {
    expect(buildTsQuery("Inflation rose 5 percent in 2023")).toBe("inflation | rose | 5 | percent | 2023");
  });

  it("removes duplicate terms", () => {
    expect(buildTsQuery("rate rate Rate RATE")).toBe("rate");
  });

  it("strips everything that could be a tsquery operator", () => {
    const query = buildTsQuery("a & b | !c :* ' ; -- (x) <-> \"quoted\" rate\\");
    expect(query).toBe("quoted | rate");
    expect(query).not.toMatch(/[&!:*'();<>\\"-]/);
  });

  it("returns an empty string when only stopwords or punctuation remain", () => {
    expect(buildTsQuery("the of and")).toBe("");
    expect(buildTsQuery("  ... ?!  ")).toBe("");
    expect(buildTsQuery("")).toBe("");
  });

  it("handles accented and non-Latin letters", () => {
    expect(buildTsQuery("café résumé 東京")).toBe("café | résumé | 東京");
  });

  it("caps the number of terms", () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    expect(buildTsQuery(text).split(" | ")).toHaveLength(30);
  });
});
