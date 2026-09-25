/**
 * Contracts shared by api and web. The single source of truth for shapes that
 * cross the network boundary. Change these first, then let the compiler tell
 * you what broke.
 */
import { z } from "zod";

export const DocumentKind = z.enum(["resume", "job"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentSummary = z.object({
  id: z.string().uuid(),
  kind: DocumentKind,
  title: z.string(),
  /** Human label such as "Job #2" — what users type in questions. */
  label: z.string(),
  createdAt: z.string().datetime(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** A chunk is a structural unit (one job entry, one requirement), not a fixed window. */
export const Chunk = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  section: z.string(), // e.g. "experience", "requirements", "nice_to_have"
  text: z.string(),
});
export type Chunk = z.infer<typeof Chunk>;

// ---- Structured extraction -------------------------------------------------

export const Requirement = z.object({
  text: z.string(),
  skill: z.string(),
  priority: z.enum(["must", "nice"]),
});

export const JobProfile = z.object({
  title: z.string(),
  company: z.string().optional(),
  requirements: z.array(Requirement),
});
export type JobProfile = z.infer<typeof JobProfile>;

export const FitStatus = z.enum(["met", "partial", "missing"]);

export const FitRow = z.object({
  requirement: Requirement,
  status: FitStatus,
  rationale: z.string(),
  evidenceChunkIds: z.array(z.string().uuid()),
});
export type FitRow = z.infer<typeof FitRow>;

// ---- Chat ------------------------------------------------------------------

export const Intent = z.enum(["fit", "gaps", "compare", "interview_prep", "general", "off_topic"]);
export type Intent = z.infer<typeof Intent>;

export const ChatRequest = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const Citation = z.object({
  chunkId: z.string().uuid(),
  documentLabel: z.string(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof Citation>;

/** Server-sent events emitted by POST /chat. */
export const ChatEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("intent"), intent: Intent }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({ type: z.literal("citations"), citations: z.array(Citation) }),
  z.object({ type: z.literal("done"), traceId: z.string().optional() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;
