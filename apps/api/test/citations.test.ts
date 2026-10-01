import { describe, expect, it } from "vitest";
import { extractCitations, type RefTarget } from "../src/lib/citations.js";

const target = (ref: string): RefTarget => ({
  ref,
  chunkId: `00000000-0000-4000-8000-00000000000${ref.slice(1)}`,
  documentId: "00000000-0000-4000-8000-000000000000",
  documentLabel: "Job #1",
  text: `text for ${ref}`,
});
const targets = new Map(["C1", "C2", "C3"].map((r) => [r, target(r)]));

describe("extractCitations", () => {
  it("returns cited refs in order of first appearance, deduplicated", () => {
    const out = extractCitations("A [C2]. B [C1][C2]. C [C2].", targets);
    expect(out.map((c) => c.ref)).toEqual(["C2", "C1"]);
    expect(out[0]).toMatchObject({ chunkId: target("C2").chunkId, documentLabel: "Job #1", snippet: "text for C2" });
  });

  it("drops refs that were not in the context", () => {
    expect(extractCitations("Invented [C9] and [X1] and [c1].", targets)).toEqual([]);
  });
});
