import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Chunk, Citation, FitRow, JobProfile, ResumeProfile } from "@career-intel/shared";
import { connect } from "../db/client.js";
import { chunks, documents, fitCache, messages, sessions } from "../db/schema.js";
import { tokenize } from "../lib/text.js";
import type { Store, StoredDocument } from "./types.js";
import { jobNumber } from "./types.js";

const chunkColumns = {
  id: chunks.id,
  documentId: chunks.documentId,
  section: chunks.section,
  text: chunks.text,
};

/** Arbitrary constant: serialises label assignment across concurrent uploads. */
const LABEL_LOCK = 4242;

export function postgresStore(url: string): Store {
  const { db, sql: client } = connect(url);

  const scope = (documentIds?: string[]) =>
    documentIds ? inArray(chunks.documentId, documentIds.length ? documentIds : ["00000000-0000-0000-0000-000000000000"]) : undefined;

  const withCounts = async (where?: ReturnType<typeof eq>): Promise<StoredDocument[]> => {
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

    async insertDocument(doc) {
      const id = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${LABEL_LOCK})`);
        let label = "Resume";
        if (doc.kind === "resume") {
          await tx.delete(documents).where(eq(documents.kind, "resume"));
        } else {
          const labels = await tx.select({ label: documents.label }).from(documents).where(eq(documents.kind, "job"));
          label = `Job #${Math.max(0, ...labels.map((l) => jobNumber(l.label))) + 1}`;
        }
        const [row] = await tx
          .insert(documents)
          .values({
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
        await tx.delete(fitCache);
        return documentId;
      });
      const [stored] = await withCounts(eq(documents.id, id));
      return stored!;
    },
    listDocuments: () => withCounts(),
    async getDocument(id) {
      return (await withCounts(eq(documents.id, id)))[0] ?? null;
    },
    async getChunks(documentId) {
      return db.select(chunkColumns).from(chunks).where(eq(chunks.documentId, documentId)).orderBy(asc(chunks.ordinal));
    },
    async deleteDocument(id) {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
        if (deleted.length) await tx.delete(fitCache);
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

    async getOrCreateSession(id) {
      await db.insert(sessions).values({ id }).onConflictDoNothing();
      const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
      return { id, summary: s!.summary, summarizedCount: s!.summarizedCount };
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
