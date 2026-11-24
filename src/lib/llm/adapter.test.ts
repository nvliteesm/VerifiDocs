import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EMBEDDING_DIMENSIONS,
  LlmConfigError,
  LlmOutputError,
  LlmUnavailableError,
  createLlm,
  loadLlmConfig,
  parseModelJson,
  type GeminiClientLike,
  type LlmConfig,
} from "./adapter";

const config: LlmConfig = {
  apiKey: "test-key",
  generationModel: "test-generation-model",
  embeddingModel: "test-embedding-model",
};

type GenerateParams = Parameters<GeminiClientLike["models"]["generateContent"]>[0];
type EmbedParams = Parameters<GeminiClientLike["models"]["embedContent"]>[0];

function fakeClient(options: {
  texts?: (string | undefined)[];
  embedDims?: number;
  generateError?: unknown;
}) {
  const generateCalls: GenerateParams[] = [];
  const embedCalls: EmbedParams[] = [];
  let generateIndex = 0;

  const client: GeminiClientLike = {
    models: {
      async generateContent(params) {
        generateCalls.push(params);
        if (options.generateError) throw options.generateError;
        const text = options.texts?.[generateIndex];
        generateIndex += 1;
        return { text };
      },
      async embedContent(params) {
        embedCalls.push(params);
        const dims = options.embedDims ?? EMBEDDING_DIMENSIONS;
        return {
          embeddings: params.contents.map((_, i) => ({
            values: Array.from({ length: dims }, () => i),
          })),
        };
      },
    },
  };
  return { client, generateCalls, embedCalls };
}

const verdictSchema = z.object({ verdict: z.string(), page: z.number() });

describe("loadLlmConfig", () => {
  it("reads the optional review model, and offers a review only when it is set", () => {
    const base = { GEMINI_API_KEY: "k", GEMINI_MODEL: "main-model", GEMINI_EMBEDDING_MODEL: "embed-model" };
    expect(loadLlmConfig(base).reviewModel).toBeUndefined();
    expect(loadLlmConfig({ ...base, GEMINI_REVIEW_MODEL: "  " }).reviewModel).toBeUndefined();
    expect(loadLlmConfig({ ...base, GEMINI_REVIEW_MODEL: "review-model" }).reviewModel).toBe("review-model");
    expect(createLlm(config, fakeClient({}).client).reviewAvailable).toBe(false);
    expect(createLlm({ ...config, reviewModel: "test-review-model" }, fakeClient({}).client).reviewAvailable).toBe(true);
  });

  it("names every missing variable and never a value", () => {
    expect(() => loadLlmConfig({ GEMINI_API_KEY: "secret-value" })).toThrow(
      /GEMINI_MODEL, GEMINI_EMBEDDING_MODEL/,
    );
    try {
      loadLlmConfig({ GEMINI_API_KEY: "secret-value" });
    } catch (error) {
      expect(error).toBeInstanceOf(LlmConfigError);
      expect((error as Error).message).not.toContain("secret-value");
    }
  });

  it("reads all three variables", () => {
    expect(
      loadLlmConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "m", GEMINI_EMBEDDING_MODEL: "e" }),
    ).toEqual({ apiKey: "k", generationModel: "m", embeddingModel: "e" });
  });
});

describe("embed", () => {
  it("sends batches of 100 in order, with the configured model, task type and 768 dimensions", async () => {
    const { client, embedCalls } = fakeClient({});
    const llm = createLlm(config, client);

    const vectors = await llm.embed(
      Array.from({ length: 250 }, (_, i) => `text ${i}`),
      "document",
    );

    expect(embedCalls.map((call) => call.contents.length)).toEqual([100, 100, 50]);
    expect(embedCalls[0]?.model).toBe("test-embedding-model");
    expect(embedCalls[0]?.config).toMatchObject({
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
    });
    expect(embedCalls[0]?.config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(vectors).toHaveLength(250);
    // The fake fills each vector with its index inside the batch, so order is observable.
    expect(vectors[0]?.[0]).toBe(0);
    expect(vectors[99]?.[0]).toBe(99);
    expect(vectors[100]?.[0]).toBe(0);
  });

  it("uses the query task type for queries", async () => {
    const { client, embedCalls } = fakeClient({});
    await createLlm(config, client).embed(["a question"], "query");
    expect(embedCalls[0]?.config?.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("returns an empty list without calling the API for no input", async () => {
    const { client, embedCalls } = fakeClient({});
    expect(await createLlm(config, client).embed([], "document")).toEqual([]);
    expect(embedCalls).toHaveLength(0);
  });

  it("rejects a vector that is not 768 dimensions", async () => {
    const { client } = fakeClient({ embedDims: 3 });
    await expect(createLlm(config, client).embed(["x"], "document")).rejects.toThrow(
      /expected 768/,
    );
  });
});

describe("generateJson", () => {
  it("returns validated JSON and sends the model, JSON mime type and temperature 0", async () => {
    const { client, generateCalls } = fakeClient({
      texts: ['{"verdict":"supported","page":4}'],
    });
    const result = await createLlm(config, client).generateJson({
      prompt: "judge this",
      schema: verdictSchema,
      system: "you are a judge",
    });

    expect(result).toEqual({ verdict: "supported", page: 4 });
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.model).toBe("test-generation-model");
    expect(generateCalls[0]?.config).toMatchObject({
      responseMimeType: "application/json",
      temperature: 0,
      systemInstruction: "you are a judge",
    });
    expect(generateCalls[0]?.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("retries once when the first answer is not valid JSON", async () => {
    const { client, generateCalls } = fakeClient({
      texts: ["not json at all", '{"verdict":"partial","page":2}'],
    });
    const result = await createLlm(config, client).generateJson({
      prompt: "p",
      schema: verdictSchema,
    });
    expect(result).toEqual({ verdict: "partial", page: 2 });
    expect(generateCalls).toHaveLength(2);
  });

  it("accepts a complete JSON object that is followed by stray text, without a retry", async () => {
    const { client, generateCalls } = fakeClient({
      texts: ['{"verdict":"partial","page":2}\n"}'],
    });
    const result = await createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema });
    expect(result).toEqual({ verdict: "partial", page: 2 });
    expect(generateCalls).toHaveLength(1);
  });

  it("does not mistake braces inside a string for the end of the object", () => {
    expect(parseModelJson('{"sentence":"a } b \\" c"} trailing')).toEqual({ sentence: 'a } b " c' });
    expect(() => parseModelJson('{"sentence":"unfinished')).toThrow();
    expect(() => parseModelJson("no json here")).toThrow();
    expect(() => parseModelJson('Here you go: {"a":1}')).toThrow(); // text BEFORE the object is not repaired
  });

  it("retries once when the JSON does not match the schema", async () => {
    const { client, generateCalls } = fakeClient({
      texts: ['{"verdict":"supported"}', '{"verdict":"supported","page":1}'],
    });
    await createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema });
    expect(generateCalls).toHaveLength(2);
  });

  it("gives up after two bad answers and never echoes the model's output", async () => {
    const leaky = "the student's private draft sentence";
    const { client, generateCalls } = fakeClient({ texts: [leaky, leaky] });

    const attempt = createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema });
    await expect(attempt).rejects.toBeInstanceOf(LlmOutputError);
    await expect(attempt).rejects.not.toThrow(/private draft/);
    expect(generateCalls).toHaveLength(2);
  });

  it("does not repair fenced JSON silently", async () => {
    const fenced = '```json\n{"verdict":"supported","page":1}\n```';
    const { client } = fakeClient({ texts: [fenced, fenced] });
    await expect(
      createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema }),
    ).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("wraps an API failure as LlmUnavailableError and does not retry it", async () => {
    const apiError = Object.assign(new Error("rate limited: contains the prompt text"), { status: 429 });
    const { client, generateCalls } = fakeClient({ generateError: apiError });

    const attempt = createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema });
    await expect(attempt).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(attempt).rejects.toMatchObject({ status: 429 });
    await expect(attempt).rejects.not.toThrow(/prompt text/);
    expect(generateCalls).toHaveLength(1); // an API failure is not retried inside the adapter
  });
});

describe("timeouts (hard rule 6: no request may run long)", () => {
  /** Never answers; rejects only when the deadline aborts it, as the real client does. */
  const hangsUntilAborted = (signal?: AbortSignal) =>
    new Promise<never>((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
    });

  it("gives a generation call a deadline, reports a stall as unavailable, and does not retry it", async () => {
    let calls = 0;
    const client: GeminiClientLike = {
      models: {
        async generateContent(params) {
          calls += 1;
          return hangsUntilAborted(params.config?.abortSignal);
        },
        async embedContent() {
          throw new Error("not used");
        },
      },
    };
    const attempt = createLlm({ ...config, timeoutMs: 25 }, client).generateJson({ prompt: "p", schema: verdictSchema });
    await expect(attempt).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(attempt).rejects.toThrow(/timed out/);
    expect(calls).toBe(1);
  });

  it("sends a review request to the review model, and the main model otherwise", async () => {
    const { client, generateCalls } = fakeClient({ texts: ['{"verdict":"supported","page":1}', '{"verdict":"partial","page":1}'] });
    const llm = createLlm({ ...config, reviewModel: "test-review-model" }, client);
    await llm.generateJson({ prompt: "judge", schema: verdictSchema });
    await llm.generateJson({ prompt: "look again", schema: verdictSchema, role: "review" });
    expect(generateCalls.map((call) => call.model)).toEqual(["test-generation-model", "test-review-model"]);
  });

  it("refuses a review request when no review model is set, instead of quietly using the main model", async () => {
    const { client, generateCalls } = fakeClient({ texts: ['{"verdict":"supported","page":1}'] });
    const attempt = createLlm(config, client).generateJson({ prompt: "look again", schema: verdictSchema, role: "review" });
    await expect(attempt).rejects.toBeInstanceOf(LlmConfigError);
    expect(generateCalls).toHaveLength(0);
  });

  it("gives one request its own deadline when asked", async () => {
    const client: GeminiClientLike = {
      models: {
        async generateContent(params) {
          return hangsUntilAborted(params.config?.abortSignal);
        },
        async embedContent() {
          throw new Error("not used");
        },
      },
    };
    const started = Date.now();
    const attempt = createLlm({ ...config, timeoutMs: 60_000 }, client).generateJson({ prompt: "p", schema: verdictSchema, timeoutMs: 25 });
    await expect(attempt).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("gives an embedding call a deadline too", async () => {
    const client: GeminiClientLike = {
      models: {
        async generateContent() {
          throw new Error("not used");
        },
        async embedContent(params) {
          return hangsUntilAborted(params.config?.abortSignal);
        },
      },
    };
    await expect(createLlm({ ...config, timeoutMs: 25 }, client).embed(["x"], "document")).rejects.toThrow(/timed out/);
  });

  it("uses a default deadline well under a serverless limit, and a call that answers in time is unaffected", async () => {
    let signal: AbortSignal | undefined;
    const client: GeminiClientLike = {
      models: {
        async generateContent(params) {
          signal = params.config?.abortSignal;
          return { text: '{"verdict":"supported","page":1}' };
        },
        async embedContent() {
          throw new Error("not used");
        },
      },
    };
    const result = await createLlm(config, client).generateJson({ prompt: "p", schema: verdictSchema });
    expect(result).toEqual({ verdict: "supported", page: 1 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });
});
