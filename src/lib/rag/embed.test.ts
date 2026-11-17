import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, type EmbedTask, type Llm } from "../llm/adapter";
import type { Chunk } from "./chunker";
import { embedChunks, embedQuery, toVectorLiteral } from "./embed";

function fakeLlm() {
  const calls: { texts: string[]; task: EmbedTask }[] = [];
  const llm: Llm = {
    async generateJson() {
      throw new Error("not used");
    },
    async embed(texts, task) {
      calls.push({ texts, task });
      return texts.map((_, i) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => i + 1));
    },
  };
  return { llm, calls };
}

const chunk = (i: number): Chunk => ({
  chunkIndex: i,
  pageNumber: 1,
  content: `chunk ${i}`,
  tokenCount: 3,
});

describe("embedChunks", () => {
  it("embeds chunk text as documents and keeps chunks and vectors paired in order", async () => {
    const { llm, calls } = fakeLlm();
    const result = await embedChunks(llm, [chunk(0), chunk(1), chunk(2)]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe("document");
    expect(calls[0]!.texts).toEqual(["chunk 0", "chunk 1", "chunk 2"]);
    expect(result.map((r) => r.chunkIndex)).toEqual([0, 1, 2]);
    expect(result.map((r) => r.embedding[0])).toEqual([1, 2, 3]);
    expect(result[0]!.content).toBe("chunk 0");
  });

  it("makes no API call for an empty list", async () => {
    const { llm, calls } = fakeLlm();
    expect(await embedChunks(llm, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("embedQuery", () => {
  it("embeds with the query task type", async () => {
    const { llm, calls } = fakeLlm();
    const vector = await embedQuery(llm, "what did the survey find?");
    expect(calls[0]!.task).toBe("query");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("rejects an empty query", async () => {
    const { llm, calls } = fakeLlm();
    await expect(embedQuery(llm, "   ")).rejects.toThrow(/empty query/);
    expect(calls).toHaveLength(0);
  });
});

describe("toVectorLiteral", () => {
  it("formats a vector for pgvector", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 0.5 : 0));
    const literal = toVectorLiteral(vector);
    expect(literal.startsWith("[0.5,0,0")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.split(",")).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("rejects a wrong length and non-finite values", () => {
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(/768/);
    const bad = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    bad[5] = Number.NaN;
    expect(() => toVectorLiteral(bad)).toThrow(/finite/);
  });
});
