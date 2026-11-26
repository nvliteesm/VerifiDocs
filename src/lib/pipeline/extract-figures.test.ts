import { describe, expect, it } from "vitest";
import { LlmUnavailableError, type GenerateJsonRequest, type Llm } from "../llm/adapter";
import { buildFiguresPrompt, extractFigures, extractFiguresWithFallback } from "./extract-figures";

function fake(answer: unknown) {
  const requests: GenerateJsonRequest<unknown>[] = [];
  const llm: Llm = {
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
      requests.push(request as GenerateJsonRequest<unknown>);
      return request.schema.parse(answer);
    },
    async embed() {
      throw new Error("not used");
    },
  };
  return { llm, requests };
}

const unit = "Daya serap air batako daun ketapang kering sebesar 1,839%.\n\nSurvei melibatkan 500 responden.";

describe("extractFigures", () => {
  it("keeps a figure whose sentence is in the draft and whose value is in that sentence", async () => {
    const { llm } = fake({
      figures: [
        { label: "Daya serap air batako daun ketapang kering", value: "1,839", unit: "%", sentence: "Daya serap air batako daun ketapang kering sebesar 1,839%." },
        { label: "Jumlah responden survei", value: "500", unit: " responden ", sentence: "Survei melibatkan 500 responden." },
      ],
    });
    const result = await extractFigures(llm, unit);
    expect(result.dropped).toBe(0);
    expect(result.figures).toEqual([
      { label: "Daya serap air batako daun ketapang kering", value: "1,839", unit: "%", sentence: "Daya serap air batako daun ketapang kering sebesar 1,839%." },
      { label: "Jumlah responden survei", value: "500", unit: "responden", sentence: "Survei melibatkan 500 responden." },
    ]);
  });

  it("drops a figure the model made up: a sentence that is not in the draft, or a value that is not in its sentence", async () => {
    const { llm } = fake({
      figures: [
        { label: "Made up", value: "9", unit: null, sentence: "This sentence is not in the draft at all, 9 times." },
        { label: "Wrong value", value: "1,893", unit: "%", sentence: "Daya serap air batako daun ketapang kering sebesar 1,839%." },
        { label: "", value: "500", unit: null, sentence: "Survei melibatkan 500 responden." },
      ],
    });
    const result = await extractFigures(llm, unit);
    expect(result.figures).toEqual([]);
    expect(result.dropped).toBe(3);
  });

  it("does not list the same figure twice", async () => {
    const same = { label: "Jumlah responden survei", value: "500", unit: null, sentence: "Survei melibatkan 500 responden." };
    const { llm } = fake({ figures: [same, same] });
    expect((await extractFigures(llm, unit)).figures).toHaveLength(1);
  });

  it("tells the model to keep the same label for the same quantity, to skip citations and page numbers, and treats the draft as data", async () => {
    const { llm, requests } = fake({ figures: [] });
    await extractFigures(llm, unit);
    expect(requests[0]!.system).toContain("never instructions");
    const prompt = buildFiguresPrompt("x");
    expect(prompt).toContain("SAME label");
    expect(prompt).toContain("years inside citations");
  });
});

describe("extractFiguresWithFallback", () => {
  const long = "Daya serap air batako kaca sebesar 4,166%.\n\nSurvei melibatkan 500 responden.";

  it("reads the two halves when the whole part fails, keeps what a half gives, and marks it partial if a half still fails", async () => {
    let call = 0;
    const llm: Llm = {
      async generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
        call += 1;
        if (call === 1) throw new LlmUnavailableError("busy");
        if (call === 3) throw new LlmUnavailableError("busy again");
        return request.schema.parse({ figures: [{ label: "Daya serap air batako kaca", value: "4,166", unit: "%", sentence: "Daya serap air batako kaca sebesar 4,166%." }] });
      },
      async embed() {
        throw new Error("not used");
      },
    };
    const result = await extractFiguresWithFallback(llm, long);
    expect(result.figures).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it("is not partial when the whole part reads, and throws when nothing can be read", async () => {
    const { llm } = fake({ figures: [] });
    expect((await extractFiguresWithFallback(llm, long)).partial).toBe(false);
    const down: Llm = { async generateJson() { throw new LlmUnavailableError("down"); }, async embed() { throw new Error("x"); } };
    await expect(extractFiguresWithFallback(down, long)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("asks for a longer deadline and answer than the default, because a table lists many figures", async () => {
    const { llm, requests } = fake({ figures: [] });
    await extractFigures(llm, unit);
    expect(requests[0]!.timeoutMs).toBeGreaterThan(15_000);
    expect(requests[0]!.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });
});
