import type { Chunk, Citation, DocumentKind, FitRow, JobProfile, ResumeProfile } from "@career-intel/shared";

/**
 * Persistence boundary. Postgres in real use; an in-memory implementation
 * with identical semantics backs route tests, CI evals and a no-database dev
 * mode. Retrieval primitives live here so each backend can use its native
 * index (pgvector / tsvector) while fusion stays a pure function elsewhere.
 */
export interface StoredDocument {
  id: string;
  kind: DocumentKind;
  label: string;
  title: string;
  filename: string;
  profile: JobProfile | ResumeProfile;
  embeddingModel: string;
  chunkCount: number;
  createdAt: Date;
}

export interface NewDocument {
  kind: DocumentKind;
  title: string;
  filename: string;
  profile: JobProfile | ResumeProfile;
  embeddingModel: string;
  chunks: { section: string; text: string; embedding: number[] }[];
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  citations: Citation[];
  createdAt: Date;
}

export interface SessionState {
  id: string;
  summary: string;
  summarizedCount: number;
}

export interface SearchOptions {
  limit: number;
  /** Restrict to these documents; undefined means all. */
  documentIds?: string[];
}

export interface Store {
  readonly kind: "postgres" | "memory";
  ping(): Promise<void>;
  close(): Promise<void>;

  /**
   * Atomically: assigns the label ("Resume" / next "Job #N"), replaces any
   * previous resume, writes document + chunks, and invalidates fit caches.
   */
  insertDocument(doc: NewDocument): Promise<StoredDocument>;
  listDocuments(): Promise<StoredDocument[]>;
  getDocument(id: string): Promise<StoredDocument | null>;
  /** Chunks of one document in reading order. */
  getChunks(documentId: string): Promise<Chunk[]>;
  deleteDocument(id: string): Promise<boolean>;

  /** Nearest chunks by cosine distance, best first. */
  vectorSearch(embedding: number[], opts: SearchOptions): Promise<Chunk[]>;
  /** Full-text matches (any query term), best first. */
  textSearch(query: string, opts: SearchOptions): Promise<Chunk[]>;

  getOrCreateSession(id: string): Promise<SessionState>;
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  appendMessage(sessionId: string, message: Omit<StoredMessage, "createdAt">): Promise<void>;
  updateSummary(sessionId: string, summary: string, summarizedCount: number): Promise<void>;

  getFit(jobId: string): Promise<FitRow[] | null>;
  putFit(jobId: string, rows: FitRow[]): Promise<void>;
}

/** "Job #3" → 3. */
export function jobNumber(label: string): number {
  return Number(label.match(/^Job #(\d+)$/)?.[1] ?? 0);
}
