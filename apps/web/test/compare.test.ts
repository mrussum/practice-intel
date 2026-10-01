import { describe, expect, it } from "vitest";
import type { FitRow } from "@career-intel/shared";
import { buildCompareRows } from "../src/components/CompareView";
import { summarizeFit } from "../src/components/FitMatrix";

const row = (skill: string, status: FitRow["status"], priority: "must" | "nice" = "must"): FitRow => ({
  requirement: { text: skill, skill, priority },
  status,
  rationale: "",
  evidenceChunkIds: [],
});

describe("buildCompareRows", () => {
  it("orders requirements by how many jobs share them, must-haves first", () => {
    const rows = buildCompareRows([
      { jobId: "a", rows: [row("TypeScript", "met"), row("Kubernetes", "missing"), row("Figma", "missing", "nice")] },
      { jobId: "b", rows: [row("typescript ", "met"), row("SQL", "partial")] },
    ]);
    expect(rows.map((r) => r.skill)).toEqual(["TypeScript", "Kubernetes", "SQL", "Figma"]);
    expect(rows[0]!.cells.get("b")?.status).toBe("met");
    expect(rows[1]!.cells.has("b")).toBe(false);
  });
});

describe("summarizeFit", () => {
  it("counts must-haves by status", () => {
    const s = summarizeFit([row("A", "met"), row("B", "partial"), row("C", "missing"), row("D", "met", "nice")]);
    expect(s).toMatchObject({ must: 3, mustMet: 1, mustPartial: 1, mustMissing: 1, nice: 1, niceMet: 1 });
  });
});
