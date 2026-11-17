// The single Gemini adapter. This is the only module that may import "@google/genai" (hard rule 2,
// enforced by tests/rules/llm-adapter.test.ts). The product and the eval harness both use it.
//
// - Model names come from env vars, never from literals in code.
// - Error messages never contain prompt text or model output, because either can hold draft text.
import { GoogleGenAI } from "@google/genai";
import type { ZodType } from "zod";

/** Matches the `vector(768)` column in db/migrations/0001_init.sql. */
export const EMBEDDING_DIMENSIONS = 768;
const EMBED_BATCH_SIZE = 100;
/** One initial attempt plus one retry when the model's JSON is malformed or fails the schema. */
const MAX_JSON_ATTEMPTS = 2;
/**
 * Every request has a hard deadline, because no request may run long (hard rule 6) and a stalled call would
 * otherwise hang a claim check indefinitely. A timeout is reported as LlmUnavailableError, which the claim
 * check retries a bounded number of times.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export type EmbedTask = "document" | "query";

const TASK_TYPES: Record<EmbedTask, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

export interface LlmConfig {
  apiKey: string;
  generationModel: string;
  embeddingModel: string;
  /** Hard deadline for each Gemini request. Defaults to 15 seconds. */
  timeoutMs?: number;
}

/** A required env var is missing. The message names the variable, never a value. */
export class LlmConfigError extends Error {
  override name = "LlmConfigError";
}

/** The API call failed (network, quota, server error). Safe to retry at the stage level. */
export class LlmUnavailableError extends Error {
  override name = "LlmUnavailableError";
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** The model answered, but not in a usable shape (malformed JSON, schema mismatch, wrong size). */
export class LlmOutputError extends Error {
  override name = "LlmOutputError";
}

/** The slice of the Gemini client this adapter uses. Tests pass a fake. */
export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: {
        systemInstruction?: string;
        responseMimeType?: string;
        temperature?: number;
        abortSignal?: AbortSignal;
      };
    }): Promise<{ text?: string | undefined }>;
    embedContent(params: {
      model: string;
      contents: string[];
      config?: { taskType?: string; outputDimensionality?: number; abortSignal?: AbortSignal };
    }): Promise<{ embeddings?: { values?: number[] | undefined }[] | undefined }>;
  };
}

export interface GenerateJsonRequest<T> {
  prompt: string;
  schema: ZodType<T>;
  system?: string;
  /** Defaults to 0 so verdicts are as repeatable as the API allows. */
  temperature?: number;
}

export interface Llm {
  /** Asks for JSON, validates it against `schema`, and retries once if it is malformed. */
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<T>;
  /** Embeds texts at 768 dimensions, in batches of 100, returned in input order. */
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

export function loadLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const names = ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_EMBEDDING_MODEL"] as const;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new LlmConfigError(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    apiKey: env.GEMINI_API_KEY as string,
    generationModel: env.GEMINI_MODEL as string,
    embeddingModel: env.GEMINI_EMBEDDING_MODEL as string,
  };
}

function toUnavailable(error: unknown): LlmUnavailableError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") {
    const timedOut = new LlmUnavailableError("The Gemini API request timed out.");
    timedOut.cause = error;
    return timedOut;
  }
  const detail = status !== undefined && !Number.isNaN(status) ? ` (HTTP ${status})` : "";
  const failure = new LlmUnavailableError(`The Gemini API request failed${detail}.`, status);
  failure.cause = error;
  return failure;
}

export function createLlm(config: LlmConfig, client?: GeminiClientLike): Llm {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The SDK defaults to API version v1, which rejects JSON mode (responseMimeType). v1beta accepts it.
  const gemini: GeminiClientLike =
    client ??
    (new GoogleGenAI({ apiKey: config.apiKey, apiVersion: "v1beta" }) as unknown as GeminiClientLike);

  async function generateJson<T>(request: GenerateJsonRequest<T>): Promise<T> {
    let lastProblem = "no attempt made";

    for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt += 1) {
      let text: string | undefined;
      try {
        const response = await gemini.models.generateContent({
          model: config.generationModel,
          contents: request.prompt,
          config: {
            abortSignal: AbortSignal.timeout(timeoutMs),
            responseMimeType: "application/json",
            temperature: request.temperature ?? 0,
            ...(request.system !== undefined ? { systemInstruction: request.system } : {}),
          },
        });
        text = response.text;
      } catch (error) {
        throw toUnavailable(error);
      }

      if (!text) {
        lastProblem = "the model returned no text";
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastProblem = "the model returned text that is not valid JSON";
        continue;
      }

      const result = request.schema.safeParse(parsed);
      if (result.success) return result.data;

      const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)");
      lastProblem = `the JSON did not match the expected shape (fields: ${paths.join(", ")})`;
    }

    throw new LlmOutputError(`Gemini output rejected after ${MAX_JSON_ATTEMPTS} attempts: ${lastProblem}.`);
  }

  async function embed(texts: string[], task: EmbedTask): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE);

      let embeddings: { values?: number[] | undefined }[] | undefined;
      try {
        const response = await gemini.models.embedContent({
          model: config.embeddingModel,
          contents: batch,
          config: {
            abortSignal: AbortSignal.timeout(timeoutMs),
            taskType: TASK_TYPES[task],
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        });
        embeddings = response.embeddings;
      } catch (error) {
        throw toUnavailable(error);
      }

      if (!embeddings || embeddings.length !== batch.length) {
        throw new LlmOutputError(
          `Embedding batch returned ${embeddings?.length ?? 0} vectors for ${batch.length} inputs.`,
        );
      }
      for (const item of embeddings) {
        const values = item.values;
        if (!values || values.length !== EMBEDDING_DIMENSIONS) {
          throw new LlmOutputError(
            `Embedding has ${values?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}.`,
          );
        }
        vectors.push(values);
      }
    }

    return vectors;
  }

  return { generateJson, embed };
}

let shared: Llm | undefined;

/** The app-wide adapter, built lazily from the environment. */
export function getLlm(): Llm {
  shared ??= createLlm(loadLlmConfig());
  return shared;
}
