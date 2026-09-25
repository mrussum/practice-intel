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
  filename: z.string(),
  chunkCount: z.number().int().nonnegative(),
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
export type Requirement = z.infer<typeof Requirement>;

export const JobProfile = z.object({
  title: z.string(),
  company: z.string().optional(),
  requirements: z.array(Requirement),
});
export type JobProfile = z.infer<typeof JobProfile>;

/** What the resume claims, with the sentence that backs each claim. */
export const ResumeSkill = z.object({
  skill: z.string(),
  evidence: z.string(),
  years: z.number().nonnegative().optional(),
});

export const ResumeProfile = z.object({
  name: z.string().optional(),
  headline: z.string().optional(),
  skills: z.array(ResumeSkill),
});
export type ResumeProfile = z.infer<typeof ResumeProfile>;

export const DocumentDetail = DocumentSummary.extend({
  profile: z.union([JobProfile, ResumeProfile]),
  /** In document order, so the evidence panel can show the whole document. */
  chunks: z.array(Chunk),
});
export type DocumentDetail = z.infer<typeof DocumentDetail>;

export const FitStatus = z.enum(["met", "partial", "missing"]);
export type FitStatus = z.infer<typeof FitStatus>;

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
  message: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const Citation = z.object({
  /** The marker the model wrote in the answer text, e.g. "C3". */
  ref: z.string(),
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
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

// ---- Misc ------------------------------------------------------------------

export const ReadyResponse = z.object({
  status: z.enum(["ready", "unavailable"]),
  store: z.enum(["postgres", "memory"]),
  /** "fake" means deterministic stand-ins are answering: fine for demos, not for advice. */
  ai: z.enum(["real", "fake"]),
  embeddings: z.enum(["real", "fake"]),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;
