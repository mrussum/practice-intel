import { EMBEDDING_DIM } from "../db/schema.js";
import type { Config } from "../config.js";
import { embeddingMode } from "../config.js";
import { AiProviderError } from "./errors.js";
import { tokenize } from "./text.js";

/**
 * Embeddings behind one interface so providers can be swapped and tests never
 * touch the network. All providers return EMBEDDING_DIM-length vectors,
 * because the pgvector column has a fixed size.
 */
export interface Embedder {
  /** Stored on each document so a provider switch is detectable. */
  readonly model: string;
  embed(texts: string[], inputType: "document" | "query"): Promise<number[][]>;
}

const BATCH_SIZE = 64;

async function inBatches(
  texts: string[],
  fn: (batch: string[]) => Promise<number[][]>,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await fn(texts.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<EmbeddingResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AiProviderError(`Embedding provider unreachable (${new URL(url).host}).`);
  }
  if (!res.ok) {
    // The body may echo input text, so only the status is surfaced.
    throw new AiProviderError(`Embedding request failed with HTTP ${res.status}. Check the embedding API key and model.`);
  }
  const json = (await res.json()) as EmbeddingResponse;
  return { data: [...json.data].sort((a, b) => a.index - b.index) };
}

export function voyageEmbedder(apiKey: string, model = "voyage-3-large"): Embedder {
  return {
    model,
    embed: (texts, inputType) =>
      inBatches(texts, async (batch) => {
        const json = await postJson("https://api.voyageai.com/v1/embeddings", apiKey, {
          input: batch,
          model,
          input_type: inputType,
          output_dimension: EMBEDDING_DIM,
        });
        return json.data.map((d) => d.embedding);
      }),
  };
}

export function openAiEmbedder(apiKey: string, model = "text-embedding-3-small"): Embedder {
  return {
    model,
    embed: (texts) =>
      inBatches(texts, async (batch) => {
        const json = await postJson("https://api.openai.com/v1/embeddings", apiKey, {
          input: batch,
          model,
          dimensions: EMBEDDING_DIM,
        });
        return json.data.map((d) => d.embedding);
      }),
  };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Feature-hashed bag of words. Deterministic and offline, and texts that share
 * words land near each other, so retrieval tests and fake-mode evals still
 * measure something real about the pipeline.
 */
export function fakeEmbedder(): Embedder {
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    v[0] = 0.01; // never a zero vector: cosine distance to zero is undefined
    for (const token of tokenize(text)) {
      const h = fnv1a(token);
      const i = 1 + (h % (EMBEDDING_DIM - 1));
      v[i] = (v[i] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / norm);
  };
  return { model: "fake-hash-v1", embed: async (texts) => texts.map(embedOne) };
}

export function createEmbedder(config: Config): Embedder {
  if (embeddingMode(config) === "fake") return fakeEmbedder();
  if (config.EMBEDDING_PROVIDER === "openai") {
    return openAiEmbedder(config.OPENAI_API_KEY!, config.EMBEDDING_MODEL);
  }
  return voyageEmbedder(config.VOYAGE_API_KEY!, config.EMBEDDING_MODEL);
}
