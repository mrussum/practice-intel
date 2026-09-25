import type { Config } from "./config.js";
import { createEmbedder, type Embedder } from "./lib/embeddings.js";
import { createLlm, type LLM } from "./lib/llm.js";
import { memoryStore } from "./store/memory.js";
import { postgresStore } from "./store/postgres.js";
import type { Store } from "./store/types.js";

/** Everything with I/O, built once and injected, so tests can swap any piece. */
export interface Deps {
  store: Store;
  llm: LLM;
  embedder: Embedder;
}

export async function createDeps(config: Config): Promise<Deps> {
  return {
    store: config.DATABASE_URL ? postgresStore(config.DATABASE_URL) : memoryStore(),
    llm: await createLlm(config),
    embedder: createEmbedder(config),
  };
}
