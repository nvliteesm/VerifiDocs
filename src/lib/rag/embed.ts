// Embedding helpers, ported from the legacy Python embeddings module (git tag legacy-rag-chat).
// All Gemini calls go through the single adapter (src/lib/llm/adapter.ts), which handles batching
// (100 per request), the 768-dimension setting and the document/query task types.
import { EMBEDDING_DIMENSIONS, type Llm } from "../llm/adapter";
import type { Chunk } from "./chunker";

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

/** Embeds chunk text with the document task type. Results keep the input order. */
export async function embedChunks(llm: Llm, chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  const vectors = await llm.embed(
    chunks.map((chunk) => chunk.content),
    "document",
  );
  if (vectors.length !== chunks.length) {
    throw new Error(`Expected ${chunks.length} embeddings but received ${vectors.length}.`);
  }
  return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i]! }));
}

/** Embeds a claim or question with the query task type. */
export async function embedQuery(llm: Llm, text: string): Promise<number[]> {
  if (text.trim().length === 0) throw new Error("Cannot embed an empty query.");
  const [vector] = await llm.embed([text], "query");
  if (!vector) throw new Error("No embedding was returned for the query.");
  return vector;
}

/** Formats a vector as a pgvector literal, for example "[0.1,0.2]". Use it with `::vector`. */
export function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`A vector must have ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}.`);
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("A vector must contain only finite numbers.");
  }
  return `[${vector.join(",")}]`;
}
