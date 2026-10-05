import { describe, expect, it } from "vitest";
import { scoreFit } from "../fit.js";

describe("scoreFit", () => {
  it("matches by skill name, scores exact matches and flags missing-called-met", () => {
    const s = scoreFit(
      [
        { skill: "Kubernetes", label: "missing" },
        { skill: "CI/CD", label: "partial" },
        { skill: "Go", label: "missing" },
        { skill: "Helm", label: "TODO" },
        { skill: "Rust", label: "missing" },
      ],
      [
        { skill: "kubernetes", status: "met" },
        { skill: "CI/CD pipelines", status: "partial" },
        { skill: "Go", status: "missing" },
        { skill: "Docker", status: "partial" },
      ],
    );
    expect(s).toMatchObject({ compared: 3, correct: 2, missingCalledMet: ["Kubernetes"], todo: 1, unmatchedLabels: ["Rust"], unlabelledPredictions: ["Docker"] });
    expect(s.confusion.missing.met).toBe(1);
    expect(s.confusion.partial.partial).toBe(1);
  });

  it("does not let a one-letter name match everything", () => {
    expect(scoreFit([{ skill: "Go", label: "met" }], [{ skill: "GraphQL", status: "met" }]).compared).toBe(0);
  });
});
