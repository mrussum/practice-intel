import type { Citation } from "@career-intel/shared";
import { truncate } from "./text.js";

export interface RefTarget {
  ref: string;
  chunkId: string;
  documentId: string;
  documentLabel: string;
  text: string;
}

/**
 * Citations the answer actually used, restricted to refs we put in the
 * context. A ref the model invented (or copied from a document) is dropped
 * here, so the client can never be pointed at evidence that wasn't shown.
 */
export function extractCitations(answer: string, targets: Map<string, RefTarget>): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const [, ref] of answer.matchAll(/\[(C\d+)\]/g)) {
    const t = targets.get(ref!);
    if (!t || seen.has(t.ref)) continue;
    seen.add(t.ref);
    out.push({ ref: t.ref, chunkId: t.chunkId, documentId: t.documentId, documentLabel: t.documentLabel, snippet: truncate(t.text, 200) });
  }
  return out;
}
