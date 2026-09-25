import type { DocumentKind, JobProfile, ResumeProfile } from "@career-intel/shared";
import { chunkByStructure } from "../lib/chunking.js";
import type { Embedder } from "../lib/embeddings.js";
import { extractJobProfile, extractResumeProfile } from "../lib/extract.js";
import type { LLM, LlmUsage } from "../lib/llm.js";
import { parseDocument } from "../lib/parse.js";
import type { Store, StoredDocument } from "../store/types.js";

export interface IngestDeps {
  store: Store;
  llm: LLM;
  embedder: Embedder;
}

export class IngestError extends Error {}

/**
 * parse → chunk → embed (batched) + extract profile (in parallel) → store.
 * Nothing is written until every step has succeeded, and the write itself is
 * one transaction, so a failed upload leaves no partial document behind.
 */
export async function ingestDocument(
  deps: IngestDeps,
  input: { kind: DocumentKind; filename: string; bytes: Buffer },
): Promise<{ document: StoredDocument; usages: LlmUsage[] }> {
  const text = await parseDocument(input.filename, input.bytes);
  const raw = chunkByStructure(text);
  if (raw.length === 0) throw new IngestError(`"${input.filename}" produced no content to index.`);

  const [embeddings, extracted] = await Promise.all([
    deps.embedder.embed(
      raw.map((c) => `${c.section}: ${c.text}`),
      "document",
    ),
    input.kind === "job" ? extractJobProfile(deps.llm, text) : extractResumeProfile(deps.llm, text),
  ]);

  const profile: JobProfile | ResumeProfile = extracted.profile;
  const title =
    "title" in profile ? profile.title : (profile.name ?? input.filename.replace(/\.[^.]+$/, ""));

  const document = await deps.store.insertDocument({
    kind: input.kind,
    title,
    filename: input.filename,
    profile,
    embeddingModel: deps.embedder.model,
    chunks: raw.map((c, i) => ({ ...c, embedding: embeddings[i]! })),
  });
  return { document, usages: extracted.usages };
}
