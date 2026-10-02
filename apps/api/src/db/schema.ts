import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** Must match every embedding provider's output size (see lib/embeddings.ts). */
export const EMBEDDING_DIM = 1024;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored lowercased; unique per account. */
  email: text("email").notNull().unique(),
  /** scrypt$N$r$p$salt$hash: parameters travel with the hash (see lib/auth.ts). */
  passwordHash: text("password_hash").notNull(),
  /** Highest job number ever issued, so a deleted "Job #3" is never reused for a different job. */
  jobsCreated: integer("jobs_created").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Login sessions. Only a SHA-256 of the cookie token is stored, so a DB leak can't be replayed. */
export const userSessions = pgTable(
  "user_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_sessions_user_idx").on(t.userId)],
);

export const documents = pgTable(
  "documents",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["resume", "job"] }).notNull(),
  label: text("label").notNull(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  /** JobProfile or ResumeProfile, validated by Zod before it is written. */
  profile: jsonb("profile").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_user_idx").on(t.userId, t.createdAt)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    section: text("section").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
    // Generated, so full-text search can never drift out of sync with the text.
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', "section" || ' ' || "text")`),
  },
  (t) => [
    index("chunks_document_idx").on(t.documentId, t.ordinal),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Chat sessions (conversations), not login sessions. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Running summary of turns that no longer fit the history budget. */
  summary: text("summary").notNull().default(""),
  /** Number of messages already folded into `summary`. */
  summarizedCount: integer("summarized_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    intent: text("intent"),
    citations: jsonb("citations").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_session_idx").on(t.sessionId, t.createdAt)],
);

/** FitRow[] per job. Cleared whenever any document changes (see store). */
export const fitCache = pgTable("fit_cache", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  rows: jsonb("rows").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
