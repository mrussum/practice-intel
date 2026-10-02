import { RequestError } from "./api";

/**
 * What the evidence panel says when a cited source can't be loaded. A 404
 * means the document was deleted or replaced (re-uploading a resume
 * replaces it) after the answer was written, which isn't an error the user
 * can fix by retrying.
 */
export function evidenceErrorMessage(error: unknown): string {
  if (error instanceof RequestError && error.status === 404) {
    return "This source was removed or replaced after the answer was written. Ask again to cite your current documents.";
  }
  return error instanceof Error ? error.message : "Couldn't load this source. Try again.";
}

/** Retrying can't bring back a deleted document; other failures get one retry. */
export const retryUnlessGone = (failures: number, error: unknown) =>
  !(error instanceof RequestError && error.status === 404) && failures < 1;
