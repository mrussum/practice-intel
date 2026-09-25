import type { Chunk } from "@career-intel/shared";
import type { Deps } from "../deps.js";
import { reciprocalRankFusion } from "../lib/fusion.js";

/**
 * Hybrid retrieval: dense vectors catch paraphrase ("container orchestration"
 * ≈ "Kubernetes"), full-text catches exact tokens embeddings blur ("Go",
 * "SOC 2", version numbers). Each side over-fetches, then RRF merges.
 */
export async function hybridSearch(
  deps: Pick<Deps, "store">,
  query: { text: string; embedding: number[] },
  opts: { documentIds: string[]; k: number },
): Promise<Chunk[]> {
  if (opts.documentIds.length === 0 || opts.k === 0) return [];
  const candidates = Math.max(opts.k * 2, 10);
  const [byVector, byText] = await Promise.all([
    deps.store.vectorSearch(query.embedding, { limit: candidates, documentIds: opts.documentIds }),
    deps.store.textSearch(query.text, { limit: candidates, documentIds: opts.documentIds }),
  ]);
  return reciprocalRankFusion([byVector, byText])
    .slice(0, opts.k)
    .map((r) => r.item);
}
