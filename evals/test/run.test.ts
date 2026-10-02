import { describe, expect, it } from "vitest";
import { checkAnswer, checkIntent, checkRetrieval, groundedness, scoreClaims } from "../run.js";

const base = { id: "x", question: "q", expectIntent: ["gaps" as const], expectDocs: [], forbidDocs: [], mustMention: [], mustNotMention: [] };

describe("eval scoring", () => {
  it("intent passes when the router picks any of the accepted labels", () => {
    const c = { ...base, expectIntent: ["fit" as const, "off_topic" as const] };
    expect(checkIntent(c, "off_topic")).toEqual({ ok: true, notes: [] });
    expect(checkIntent(c, "fit").ok).toBe(true);
    expect(checkIntent(c, "gaps")).toEqual({ ok: false, notes: ["intent gaps ≠ fit | off_topic"] });
  });

  it("retrieval passes only when expected docs are present and forbidden ones absent", () => {
    const c = { ...base, expectDocs: ["Job #2"], forbidDocs: ["Job #1"] };
    expect(checkRetrieval(c, new Set(["Job #2", "Resume"])).ok).toBe(true);
    expect(checkRetrieval(c, new Set(["Resume"])).notes).toEqual(["not retrieved: Job #2"]);
    expect(checkRetrieval(c, new Set(["Job #2", "Job #1"])).notes).toEqual(["should be filtered: Job #1"]);
    expect(checkRetrieval(base, new Set()).ok).toBeNull();
  });

  it("answer checks are case-insensitive substring checks", () => {
    const c = { ...base, mustMention: ["kubernetes"], mustNotMention: ["10/10"] };
    expect(checkAnswer(c, "Missing Kubernetes").ok).toBe(true);
    expect(checkAnswer(c, "Missing Go").notes).toEqual(["missing mention: kubernetes"]);
    expect(checkAnswer(c, "Kubernetes, and I rate you 10/10").notes).toEqual(["forbidden mention: 10/10"]);
  });

  it("groundedness is the share of citation markers that were in context", () => {
    expect(groundedness("a [C1] b [C2] c [C9] d [C1]", new Set(["C1", "C2"]))).toBe(0.75);
    expect(groundedness("no citations", new Set(["C1"]))).toBeNull();
  });

  it("faithfulness is the share of supported claims, listing the rest with reasons", () => {
    const out = scoreClaims([
      { claim: "Kubernetes is not in your resume", supported: true, reason: "no mention" },
      { claim: "Kafka was used at Brightpath", supported: false, reason: "Kafka is at Parcelly" },
    ]);
    expect(out).toEqual({ score: 0.5, unsupportedClaims: ["Kafka was used at Brightpath — Kafka is at Parcelly"] });
    expect(scoreClaims([]).score).toBe(1);
  });
});
