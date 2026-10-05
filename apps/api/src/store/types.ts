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
  /**
   * Documents to search. Required: callers derive it from the user's own
   * documents, so a search can never span users by omission.
   */
  documentIds: string[];
}

export interface User {
  id: string;
  email: string;
}

export interface AuthSession {
  userId: string;
  email: string;
  expiresAt: Date;
}

export interface Store {
  readonly kind: "postgres" | "memory";
  ping(): Promise<void>;
  close(): Promise<void>;

  // ---- accounts ------------------------------------------------------------
  /** Returns null if the email is already registered. */
  createUser(email: string, passwordHash: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  createAuthSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** Null when unknown or expired. */
  findAuthSession(tokenHash: string): Promise<AuthSession | null>;
  deleteAuthSession(tokenHash: string): Promise<void>;
  /** Housekeeping on login: drops the user's expired sessions. */
  deleteExpiredAuthSessions(userId: string): Promise<void>;
  /** Deletes the account and everything it owns (documents, chunks, chats, fit cache, logins). */
  deleteUser(userId: string): Promise<boolean>;

  // ---- documents (all scoped to one user) ----------------------------------
  /**
   * Atomically, for this user: assigns the label ("Resume" / next "Job #N"),
   * replaces any previous resume, writes document + chunks, and invalidates
   * the user's fit caches.
   */
  insertDocument(userId: string, doc: NewDocument): Promise<StoredDocument>;
  listDocuments(userId: string): Promise<StoredDocument[]>;
  /** Null when missing or owned by someone else (callers answer 404 either way). */
  getDocument(userId: string, id: string): Promise<StoredDocument | null>;
  /** Chunks of one of the user's documents, in reading order. */
  getChunks(userId: string, documentId: string): Promise<Chunk[]>;
  deleteDocument(userId: string, id: string): Promise<boolean>;

  /** Nearest chunks by cosine distance, best first. */
  vectorSearch(embedding: number[], opts: SearchOptions): Promise<Chunk[]>;
  /** Full-text matches (any query term), best first. */
  textSearch(query: string, opts: SearchOptions): Promise<Chunk[]>;

  // ---- chat sessions ---------------------------------------------------------
  /** Null when the id is already taken by another user's session. */
  getOrCreateSession(userId: string, id: string): Promise<SessionState | null>;
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  appendMessage(sessionId: string, message: Omit<StoredMessage, "createdAt">): Promise<void>;
  updateSummary(sessionId: string, summary: string, summarizedCount: number): Promise<void>;

  /** Callers check job ownership first (getDocument). */
  getFit(jobId: string): Promise<FitRow[] | null>;
  putFit(jobId: string, rows: FitRow[]): Promise<void>;
}

/** "Job #3" → 3. */
export function jobNumber(label: string): number {
  return Number(label.match(/^Job #(\d+)$/)?.[1] ?? 0);
}
