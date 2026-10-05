import { describe, expect, it } from "vitest";
import { RequestError } from "../src/lib/api";
import { evidenceErrorMessage, retryUnlessGone } from "../src/lib/evidence";

describe("evidence errors", () => {
  it("explains a deleted or replaced source instead of showing the raw 404", () => {
    expect(evidenceErrorMessage(new RequestError("Document not found.", 404, "not_found"))).toMatch(/^This source was removed or replaced/);
  });

  it("shows other errors as they are", () => {
    expect(evidenceErrorMessage(new RequestError("API offline", 503))).toBe("API offline");
  });

  it("doesn't retry a deleted source, and retries other failures once", () => {
    expect(retryUnlessGone(0, new RequestError("gone", 404))).toBe(false);
    expect(retryUnlessGone(0, new RequestError("busy", 503))).toBe(true);
    expect(retryUnlessGone(1, new RequestError("busy", 503))).toBe(false);
  });
});
