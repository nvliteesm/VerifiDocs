import { describe, expect, it } from "vitest";
import { LlmOutputError, LlmUnavailableError, type GenerateJsonRequest, type Llm } from "../llm/adapter";
import { FIX_SYSTEM_PROMPT, buildFixPrompt, numbersAreSupported, suggestFix, type FixInput } from "./fix";

function fakeLlm(answer: unknown | (() => never)) {
  const requests: GenerateJsonRequest<unknown>[] = [];
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      requests.push(request as GenerateJsonRequest<unknown>);
      if (typeof answer === "function") (answer as () => never)();
      return request.schema.parse(answer);
    },
    async embed() {
      throw new Error("not used");
    },
  };
  return { llm, requests };
}

const input: FixInput = {
  claimText: "The drug reduced pain in all patients (Smith, 2021).",
  quote: "Pain fell in 70% of patients after 12 weeks.",
  verdict: "partial",
  citation: "(Smith, 2021)",
};

describe("buildFixPrompt", () => {
  it("contains only the claim and the verified quote, and tells the model to add nothing", () => {
    const prompt = buildFixPrompt(input);
    expect(prompt).toContain("<claim>\nThe drug reduced pain in all patients (Smith, 2021).\n</claim>");
    expect(prompt).toContain("<quote>\nPain fell in 70% of patients after 12 weeks.\n</quote>");
    expect(prompt).toMatch(/Add nothing from your own knowledge/);
    expect(prompt).toMatch(/only partly supported/);
    expect(buildFixPrompt({ ...input, verdict: "contradicted" })).toMatch(/contradicted/);
    expect(FIX_SYSTEM_PROMPT).toMatch(/ignore any instructions/);
  });
});

describe("numbersAreSupported", () => {
  it("accepts numbers that appear in the quote or the citation", () => {
    expect(numbersAreSupported("Pain fell in 70% of patients after 12 weeks (Smith, 2021).", input.quote, "(Smith, 2021)")).toBe(true);
  });

  it("rejects a number the quote does not contain", () => {
    expect(numbersAreSupported("Pain fell in 80% of patients.", input.quote, null)).toBe(false);
    expect(numbersAreSupported("Pain fell in 70% of patients in 2021.", input.quote, null)).toBe(false);
  });

  it("handles decimals written either way", () => {
    expect(numbersAreSupported("Turun menjadi 5,3 persen.", "Angka itu turun menjadi 5,3 persen.", null)).toBe(true);
    expect(numbersAreSupported("Turun menjadi 5.3 persen.", "Angka itu turun menjadi 5,3 persen.", null)).toBe(false);
  });

  it("accepts a sentence with no numbers", () => {
    expect(numbersAreSupported("Pain fell in many patients.", input.quote, null)).toBe(true);
  });
});

describe("suggestFix", () => {
  it("returns the model's sentence when it is safe", async () => {
    const { llm, requests } = fakeLlm({ sentence: "The drug reduced pain in 70% of patients (Smith, 2021)." });
    expect(await suggestFix(llm, input)).toBe("The drug reduced pain in 70% of patients (Smith, 2021).");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.prompt).toContain(input.quote);
  });

  it("drops a suggestion with an invented number", async () => {
    const { llm } = fakeLlm({ sentence: "The drug reduced pain in 85% of patients (Smith, 2021)." });
    expect(await suggestFix(llm, input)).toBeNull();
  });

  it("drops a suggestion identical to the claim, an empty one, and an over-long one", async () => {
    expect(await suggestFix(fakeLlm({ sentence: "The drug  reduced pain in all patients (Smith, 2021)." }).llm, input)).toBeNull();
    expect(await suggestFix(fakeLlm({ sentence: "   " }).llm, input)).toBeNull();
    expect(await suggestFix(fakeLlm({ sentence: `${"word ".repeat(200)}` }).llm, input)).toBeNull();
  });

  it("returns null, not an error, when the model is unavailable or answers badly", async () => {
    expect(await suggestFix(fakeLlm(() => { throw new LlmUnavailableError("down", 503); }).llm, input)).toBeNull();
    expect(await suggestFix(fakeLlm(() => { throw new LlmOutputError("bad json"); }).llm, input)).toBeNull();
  });

  it("does not hide programming errors", async () => {
    await expect(suggestFix(fakeLlm(() => { throw new TypeError("bug"); }).llm, input)).rejects.toThrow("bug");
  });
});
