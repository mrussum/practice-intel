import { randomUUID } from "node:crypto";
import type { Chunk, FitRow } from "@career-intel/shared";
import { tokenize } from "../lib/text.js";
import type { AuthSession, SessionState, Store, StoredDocument, StoredMessage, User } from "./types.js";
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
  const users = new Map<string, User & { passwordHash: string }>();
  const authSessions = new Map<string, { userId: string; expiresAt: Date }>();
  const docs = new Map<string, StoredDocument & { userId: string }>();
  const chunks = new Map<string, MemChunk[]>();
  const sessions = new Map<string, SessionState & { userId: string }>();
  const messages = new Map<string, StoredMessage[]>();
  const fits = new Map<string, FitRow[]>();
  /** Highest job number issued per user, so deleted numbers aren't reused. */
  const jobsCreated = new Map<string, number>();

  const userDocs = (userId: string) => [...docs.values()].filter((d) => d.userId === userId);
  const clearFits = (userId: string) => userDocs(userId).forEach((d) => fits.delete(d.id));
  const owned = (userId: string, id: string) => {
    const d = docs.get(id);
    return d && d.userId === userId ? d : undefined;
  };
  const remove = (userId: string, id: string): boolean => {
    if (!owned(userId, id)) return false;
    clearFits(userId);
    docs.delete(id);
    chunks.delete(id);
    return true;
  };
  const scoped = (documentIds: string[]) =>
    [...chunks.entries()].filter(([docId]) => documentIds.includes(docId)).flatMap(([, list]) => list);
  const publicDoc = ({ userId: _owner, ...d }: StoredDocument & { userId: string }): StoredDocument => d;

  return {
    kind: "memory",
    async ping() {},
    async close() {},

    async createUser(email, passwordHash) {
      if ([...users.values()].some((u) => u.email === email)) return null;
      const user = { id: randomUUID(), email, passwordHash };
      users.set(user.id, user);
      return { id: user.id, email };
    },
    async findUserByEmail(email) {
      return [...users.values()].find((u) => u.email === email) ?? null;
    },
    async createAuthSession(tokenHash, userId, expiresAt) {
      authSessions.set(tokenHash, { userId, expiresAt });
    },
    async findAuthSession(tokenHash): Promise<AuthSession | null> {
      const s = authSessions.get(tokenHash);
      const user = s && users.get(s.userId);
      if (!s || !user || s.expiresAt.getTime() <= Date.now()) return null;
      return { userId: user.id, email: user.email, expiresAt: s.expiresAt };
    },
    async deleteAuthSession(tokenHash) {
      authSessions.delete(tokenHash);
    },
    async deleteExpiredAuthSessions(userId) {
      for (const [hash, s] of authSessions) {
        if (s.userId === userId && s.expiresAt.getTime() <= Date.now()) authSessions.delete(hash);
      }
    },

    async insertDocument(userId, doc) {
      if (doc.kind === "resume") {
        for (const d of userDocs(userId)) if (d.kind === "resume") remove(userId, d.id);
      }
      const nextJob = Math.max(jobsCreated.get(userId) ?? 0, ...userDocs(userId).map((d) => jobNumber(d.label))) + 1;
      if (doc.kind === "job") jobsCreated.set(userId, nextJob);
      const stored = {
        id: randomUUID(),
        userId,
        kind: doc.kind,
        label: doc.kind === "resume" ? "Resume" : `Job #${nextJob}`,
        title: doc.title,
        filename: doc.filename,
        profile: doc.profile,
        embeddingModel: doc.embeddingModel,
        chunkCount: doc.chunks.length,
        createdAt: new Date(),
      };
      clearFits(userId);
      docs.set(stored.id, stored);
      chunks.set(
        stored.id,
        doc.chunks.map((c, ordinal) => ({ ...c, id: randomUUID(), documentId: stored.id, ordinal })),
      );
      return publicDoc(stored);
    },
    async listDocuments(userId) {
      return userDocs(userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(publicDoc);
    },
    async getDocument(userId, id) {
      const d = owned(userId, id);
      return d ? publicDoc(d) : null;
    },
    async getChunks(userId, documentId) {
      return owned(userId, documentId) ? (chunks.get(documentId) ?? []).map(strip) : [];
    },
    async deleteDocument(userId, id) {
      return remove(userId, id);
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

    async getOrCreateSession(userId, id) {
      let s = sessions.get(id);
      if (!s) {
        s = { id, userId, summary: "", summarizedCount: 0 };
        sessions.set(id, s);
      }
      if (s.userId !== userId) return null;
      return { id: s.id, summary: s.summary, summarizedCount: s.summarizedCount };
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
      const s = sessions.get(sessionId);
      if (s) sessions.set(sessionId, { ...s, summary, summarizedCount });
    },

    async getFit(jobId) {
      return fits.get(jobId) ?? null;
    },
    async putFit(jobId, rows) {
      if (docs.has(jobId)) fits.set(jobId, rows);
    },
  };
}
