import { randomUUID } from "node:crypto";
import type { Chunk, FitRow } from "@career-intel/shared";
import { tokenize } from "../lib/text.js";
import type { SessionState, Store, StoredDocument, StoredMessage } from "./types.js";
import { jobNumber } from "./types.js";

interface MemChunk extends Chunk {
  ordinal: number;
  embedding: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const strip = ({ id, documentId, section, text }: MemChunk): Chunk => ({ id, documentId, section, text });

export function memoryStore(): Store {
  const docs = new Map<string, StoredDocument>();
  const chunks = new Map<string, MemChunk[]>();
  const sessions = new Map<string, SessionState>();
  const messages = new Map<string, StoredMessage[]>();
  const fits = new Map<string, FitRow[]>();

  const scoped = (documentIds?: string[]) =>
    [...chunks.entries()]
      .filter(([docId]) => !documentIds || documentIds.includes(docId))
      .flatMap(([, list]) => list);

  const remove = (id: string): boolean => {
    const existed = docs.delete(id);
    chunks.delete(id);
    if (existed) fits.clear();
    return existed;
  };

  return {
    kind: "memory",
    async ping() {},
    async close() {},

    async insertDocument(doc) {
      if (doc.kind === "resume") {
        for (const d of [...docs.values()]) if (d.kind === "resume") remove(d.id);
      }
      const nextJob = Math.max(0, ...[...docs.values()].map((d) => jobNumber(d.label))) + 1;
      const stored: StoredDocument = {
        id: randomUUID(),
        kind: doc.kind,
        label: doc.kind === "resume" ? "Resume" : `Job #${nextJob}`,
        title: doc.title,
        filename: doc.filename,
        profile: doc.profile,
        embeddingModel: doc.embeddingModel,
        chunkCount: doc.chunks.length,
        createdAt: new Date(),
      };
      docs.set(stored.id, stored);
      chunks.set(
        stored.id,
        doc.chunks.map((c, ordinal) => ({ ...c, id: randomUUID(), documentId: stored.id, ordinal })),
      );
      fits.clear();
      return stored;
    },
    async listDocuments() {
      return [...docs.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async getDocument(id) {
      return docs.get(id) ?? null;
    },
    async getChunks(documentId) {
      return (chunks.get(documentId) ?? []).map(strip);
    },
    async deleteDocument(id) {
      return remove(id);
    },

    async vectorSearch(embedding, { limit, documentIds }) {
      return scoped(documentIds)
        .map((c) => ({ c, score: cosine(embedding, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ c }) => strip(c));
    },
    async textSearch(query, { limit, documentIds }) {
      // Crude stand-in for ts_rank: count of query-term occurrences.
      const terms = new Set(tokenize(query));
      return scoped(documentIds)
        .map((c) => ({ c, score: tokenize(`${c.section} ${c.text}`).filter((t) => terms.has(t)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ c }) => strip(c));
    },

    async getOrCreateSession(id) {
      let s = sessions.get(id);
      if (!s) {
        s = { id, summary: "", summarizedCount: 0 };
        sessions.set(id, s);
      }
      return { ...s };
    },
    async listMessages(sessionId) {
      return [...(messages.get(sessionId) ?? [])];
    },
    async appendMessage(sessionId, message) {
      const list = messages.get(sessionId) ?? [];
      list.push({ ...message, createdAt: new Date() });
      messages.set(sessionId, list);
    },
    async updateSummary(sessionId, summary, summarizedCount) {
      sessions.set(sessionId, { id: sessionId, summary, summarizedCount });
    },

    async getFit(jobId) {
      return fits.get(jobId) ?? null;
    },
    async putFit(jobId, rows) {
      if (docs.has(jobId)) fits.set(jobId, rows);
    },
  };
}
