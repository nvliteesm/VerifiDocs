import { describe, expect, it } from "vitest";
import { wordDiff } from "./word-diff";

describe("wordDiff", () => {
  it("marks one changed number and leaves the rest plain", () => {
    const diff = wordDiff("A survey of 500 respondents found it.", "A survey of 300 respondents found it.");
    expect(diff).toEqual({ pre: "A survey of ", oldMid: "500", newMid: "300", post: " respondents found it." });
  });

  it("keeps a longer rewrite as one run in the middle, and joins back to both sentences", () => {
    const before = "Ads always raise purchase intent among young consumers.";
    const after = "Ads raised purchase intent among consumers aged 18 to 24.";
    const diff = wordDiff(before, after);
    expect(diff.pre + diff.oldMid + diff.post).toBe(before);
    expect(diff.pre + diff.newMid + diff.post).toBe(after);
  });

  it("shows an addition with nothing struck out, and a removal with nothing added", () => {
    expect(wordDiff("It rose today.", "It rose sharply today.")).toEqual({ pre: "It rose ", oldMid: "", newMid: "sharply ", post: "today." });
    expect(wordDiff("It rose sharply today.", "It rose today.")).toEqual({ pre: "It rose ", oldMid: "sharply ", newMid: "", post: "today." });
  });

  it("returns empty middles for identical text", () => {
    expect(wordDiff("Same words.", "Same words.")).toEqual({ pre: "Same words.", oldMid: "", newMid: "", post: "" });
  });

  it("handles an empty before", () => {
    expect(wordDiff("", "New sentence.")).toEqual({ pre: "", oldMid: "", newMid: "New sentence.", post: "" });
  });
});
