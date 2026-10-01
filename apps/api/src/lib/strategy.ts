import type { Intent } from "@career-intel/shared";

/**
 * How much of which documents each intent needs. Explicit and data-driven, so
 * the trade-offs are reviewable in one place.
 *
 * - `profiles`: include extracted profiles for the resume and target jobs.
 *   Complete and compact, so "what am I missing" can't miss a requirement
 *   that retrieval didn't surface.
 * - `resumeK` / `jobK`: evidence chunks retrieved from each side, for citations.
 *
 * Target jobs are the ones the question names, or every job when none is named.
 */
export interface ContextStrategy {
  retrieve: boolean;
  profiles: boolean;
  resumeK: number;
  jobK: number;
}

export const STRATEGIES: Record<Intent, ContextStrategy> = {
  fit: { retrieve: true, profiles: true, resumeK: 6, jobK: 6 },
  gaps: { retrieve: true, profiles: true, resumeK: 6, jobK: 6 },
  compare: { retrieve: true, profiles: true, resumeK: 6, jobK: 8 },
  interview_prep: { retrieve: true, profiles: false, resumeK: 6, jobK: 6 },
  general: { retrieve: true, profiles: false, resumeK: 5, jobK: 5 },
  off_topic: { retrieve: false, profiles: false, resumeK: 0, jobK: 0 },
};
