import { describe, expect, it } from "vitest";
import type { GenerateJsonRequest, Llm } from "../llm/adapter";
import { buildContradictionsPrompt, findContradictions, type Statement } from "./find-contradictions";

const results: Statement = { sentence: "Batako daun kering menyerap air paling sedikit di antara semua bahan.", section: "Hasil", part: 1 };
const conclusion: Statement = { sentence: "Batako daun kering menyerap air paling banyak di antara semua bahan.", section: "Kesimpulan", part: 3 };
const other: Statement = { sentence: "Batako botol kaca memenuhi syarat mutu tipe satu menurut SNI.", section: "Hasil", part: 1 };

function fake(answer: unknown): { llm: Llm; prompts: string[] } {
  const prompts: string[] = [];
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      prompts.push(request.prompt);
      return request.schema.parse(answer);
    },
    async embed() {
      throw new Error("not used");
    },
  };
  return { llm, prompts };
}

describe("findContradictions", () => {
  it("returns a pair the model names, in draft order, with its note", async () => {
    const { llm } = fake({ pairs: [{ a: 2, b: 0, note: "Satu bilang paling sedikit, yang lain paling banyak." }] });
    const pairs = await findContradictions(llm, [results, other, conclusion]);
    expect(pairs).toEqual([{ a: results, b: conclusion, note: "Satu bilang paling sedikit, yang lain paling banyak." }]);
  });

  it("drops invented numbers, a sentence paired with itself, two findings in one passage, and repeats", async () => {
    const { llm } = fake({
      pairs: [
        { a: 0, b: 9, note: "x" },
        { a: 1, b: 1, note: "x" },
        { a: 0, b: 1, note: "same passage" },
        { a: 0, b: 2, note: "clash" },
        { a: 2, b: 0, note: "clash again" },
      ],
    });
    const pairs = await findContradictions(llm, [results, other, conclusion]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.note).toBe("clash");
  });

  it("does not ask the model with fewer than two findings", async () => {
    const { llm, prompts } = fake({ pairs: [] });
    expect(await findContradictions(llm, [results])).toEqual([]);
    expect(prompts).toHaveLength(0);
  });

  it("tells the model not to say which one is right and to leave unsure pairs out", () => {
    const prompt = buildContradictionsPrompt([results, conclusion]);
    expect(prompt).toContain("Do not say which one is right");
    expect(prompt).toContain("leave them out");
    expect(prompt).toContain("0. [Hasil]");
  });
});
