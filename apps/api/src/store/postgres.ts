import { and, asc, count, desc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Chunk, Citation, FitRow, JobProfile, ResumeProfile } from "@career-intel/shared";
import { connect } from "../db/client.js";
import { chunks, documents, fitCache, messages, sessions, users, userSessions } from "../db/schema.js";
import { tokenize } from "../lib/text.js";
import type { Store, StoredDocument } from "./types.js";
import { jobNumber } from "./types.js";

const chunkColumns = {
  id: chunks.id,
  documentId: chunks.documentId,
  section: chunks.section,
  text: chunks.text,
};


export function postgresStore(url: string): Store {
  const { db, sql: client } = connect(url);

  // An empty id list must match nothing (inArray([]) is not valid SQL).
  const scope = (documentIds: string[]) =>
    inArray(chunks.documentId, documentIds.length ? documentIds : ["00000000-0000-0000-0000-000000000000"]);

  const ownedBy = (userId: string, id?: string) =>
    id ? and(eq(documents.userId, userId), eq(documents.id, id)) : eq(documents.userId, userId);

  /** Fit rows depend on all of a user's documents, so any change clears that user's cache. */
  const clearFits = (tx: Pick<typeof db, "delete" | "select">, userId: string) =>
    tx.delete(fitCache).where(inArray(fitCache.jobId, tx.select({ id: documents.id }).from(documents).where(eq(documents.userId, userId))));

  const withCounts = async (where: SQL | undefined): Promise<StoredDocument[]> => {
    const rows = await db
      .select({
        id: documents.id,
        kind: documents.kind,
        label: documents.label,
        title: documents.title,
        filename: documents.filename,
        profile: documents.profile,
        embeddingModel: documents.embeddingModel,
        createdAt: documents.createdAt,
        chunkCount: count(chunks.id),
      })
      .from(documents)
      .leftJoin(chunks, eq(chunks.documentId, documents.id))
      .where(where)
      .groupBy(documents.id)
      .orderBy(asc(documents.createdAt));
    return rows.map((r) => ({ ...r, profile: r.profile as JobProfile | ResumeProfile }));
  };

  return {
    kind: "postgres",
    async ping() {
      await db.execute(sql`select 1`);
    },
    async close() {
      await client.end();
    },

    async createUser(email, passwordHash) {
      const [row] = await db
        .insert(users)
        .values({ email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, email: users.email });
      return row ?? null;
    },
    async findUserByEmail(email) {
      const [row] = await db
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, email));
      return row ?? null;
    },
    async createAuthSession(tokenHash, userId, expiresAt) {
      await db.insert(userSessions).values({ tokenHash, userId, expiresAt });
    },
    async findAuthSession(tokenHash) {
      const [row] = await db
        .select({ userId: users.id, email: users.email, expiresAt: userSessions.expiresAt })
        .from(userSessions)
        .innerJoin(users, eq(users.id, userSessions.userId))
        .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, sql`now()`)));
      return row ?? null;
    },
    async deleteAuthSession(tokenHash) {
      await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
    },
    async deleteExpiredAuthSessions(userId) {
      await db.delete(userSessions).where(and(eq(userSessions.userId, userId), lte(userSessions.expiresAt, sql`now()`)));
    },

    async deleteUser(userId) {
      // Every user-owned table cascades from users, so one delete is atomic.
      const rows = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
      return rows.length > 0;
    },

    async insertDocument(userId, doc) {
      const id = await db.transaction(async (tx) => {
        // Serialises label assignment for this user's concurrent uploads.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
        await clearFits(tx, userId);
        let label = "Resume";
        if (doc.kind === "resume") {
          await tx.delete(documents).where(and(eq(documents.userId, userId), eq(documents.kind, "resume")));
        } else {
          const labels = await tx
            .select({ label: documents.label })
            .from(documents)
            .where(and(eq(documents.userId, userId), eq(documents.kind, "job")));
          // The counter alone would restart at 1 for accounts that existed before it.
          const [owner] = await tx.select({ jobsCreated: users.jobsCreated }).from(users).where(eq(users.id, userId));
          const next = Math.max(owner?.jobsCreated ?? 0, ...labels.map((l) => jobNumber(l.label))) + 1;
          await tx.update(users).set({ jobsCreated: next }).where(eq(users.id, userId));
          label = `Job #${next}`;
        }
        const [row] = await tx
          .insert(documents)
          .values({
            userId,
            kind: doc.kind,
            label,
            title: doc.title,
            filename: doc.filename,
            profile: doc.profile,
            embeddingModel: doc.embeddingModel,
          })
          .returning({ id: documents.id });
        const documentId = row!.id;
        if (doc.chunks.length) {
          await tx.insert(chunks).values(doc.chunks.map((c, ordinal) => ({ ...c, documentId, ordinal })));
        }
        return documentId;
      });
      const [stored] = await withCounts(ownedBy(userId, id));
      return stored!;
    },
    listDocuments: (userId) => withCounts(ownedBy(userId)),
    async getDocument(userId, id) {
      return (await withCounts(ownedBy(userId, id)))[0] ?? null;
    },
    async getChunks(userId, documentId) {
      return db
        .select(chunkColumns)
        .from(chunks)
        .innerJoin(documents, eq(documents.id, chunks.documentId))
        .where(and(eq(chunks.documentId, documentId), eq(documents.userId, userId)))
        .orderBy(asc(chunks.ordinal));
    },
    async deleteDocument(userId, id) {
      return db.transaction(async (tx) => {
        await clearFits(tx, userId);
        const deleted = await tx.delete(documents).where(ownedBy(userId, id)).returning({ id: documents.id });
        return deleted.length > 0;
      });
    },

    async vectorSearch(embedding, { limit, documentIds }) {
      const vector = JSON.stringify(embedding);
      return db
        .select(chunkColumns)
        .from(chunks)
        .where(scope(documentIds))
        .orderBy(sql`${chunks.embedding} <=> ${vector}::vector`)
        .limit(limit);
    },
    async textSearch(query, { limit, documentIds }): Promise<Chunk[]> {
      // OR the terms: natural-language questions rarely contain every term of a
      // chunk, and plainto_tsquery's AND semantics would return nothing.
      const terms = [...new Set(tokenize(query).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean))];
      if (terms.length === 0) return [];
      const tsquery = sql`to_tsquery('english', ${terms.join(" | ")})`;
      return db
        .select(chunkColumns)
        .from(chunks)
        .where(and(scope(documentIds), sql`${chunks.tsv} @@ ${tsquery}`))
        .orderBy(desc(sql`ts_rank_cd(${chunks.tsv}, ${tsquery})`))
        .limit(limit);
    },

    async getOrCreateSession(userId, id) {
      await db.insert(sessions).values({ id, userId }).onConflictDoNothing();
      const [s] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
      return s ? { id, summary: s.summary, summarizedCount: s.summarizedCount } : null;
    },
    async listMessages(sessionId) {
      const rows = await db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt), asc(messages.id));
      return rows.map((r) => ({
        role: r.role,
        content: r.content,
        intent: r.intent,
        citations: r.citations as Citation[],
        createdAt: r.createdAt,
      }));
    },
    async appendMessage(sessionId, m) {
      await db.insert(messages).values({ sessionId, role: m.role, content: m.content, intent: m.intent, citations: m.citations });
    },
    async updateSummary(sessionId, summary, summarizedCount) {
      await db.update(sessions).set({ summary, summarizedCount }).where(eq(sessions.id, sessionId));
    },

    async getFit(jobId) {
      const [row] = await db.select().from(fitCache).where(eq(fitCache.jobId, jobId));
      return row ? (row.rows as FitRow[]) : null;
    },
    async putFit(jobId, rows) {
      try {
        await db
          .insert(fitCache)
          .values({ jobId, rows })
          .onConflictDoUpdate({ target: fitCache.jobId, set: { rows, createdAt: sql`now()` } });
      } catch (err) {
        // The job was deleted while its fit was computing: nothing to cache.
        const e = err as { code?: string; cause?: { code?: string } };
        if ((e.cause?.code ?? e.code) !== "23503") throw err;
      }
    },
  };
}
