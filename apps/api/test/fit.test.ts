import { afterEach, describe, expect, it } from "vitest";
import { FitRow, type DocumentSummary, type JobProfile } from "@career-intel/shared";
import { fakeLlm } from "../src/lib/fake-llm.js";
import type { LLM } from "../src/lib/llm.js";
import { toFitRows } from "../src/services/fit.js";
import { SAMPLE_JOB, SAMPLE_RESUME, testApp, upload } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

function counting() {
  const base = fakeLlm();
  const calls = { fit: 0 };
  const llm: LLM = {
    ...base,
    complete: async (req) => {
      if (req.task === "fit") calls.fit++;
      return base.complete(req);
    },
  };
  return { llm, calls };
}

describe("toFitRows", () => {
  const profile: JobProfile = {
    title: "T",
    requirements: [
      { text: "a", skill: "A", priority: "must" },
      { text: "b", skill: "B", priority: "must" },
      { text: "c", skill: "C", priority: "nice" },
    ],
  };
  const refs = new Map([["R1", "11111111-1111-4111-8111-111111111111"]]);

  it("maps rows by index, validates evidence and downgrades unsupported 'met'", () => {
    const rows = toFitRows(
      profile,
      {
        rows: [
          { requirementIndex: 0, status: "met", rationale: "Yes.", evidenceRefs: ["R1", "R1", "R7"] },
          { requirementIndex: 1, status: "met", rationale: "Claimed.", evidenceRefs: ["R9"] },
          { requirementIndex: 7, status: "met", rationale: "Hallucinated requirement.", evidenceRefs: [] },
        ],
      },
      refs,
    );
    expect(rows.map((r) => [r.requirement.skill, r.status])).toEqual([
      ["A", "met"],
      ["B", "partial"],
      ["C", "missing"],
    ]);
    expect(rows[0]!.evidenceChunkIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(rows[1]!.rationale).toContain("No citable evidence");
  });
});

describe("GET /jobs/:id/fit", () => {
  it("returns 409 until a resume exists", async () => {
    const { app } = await testApp();
    close = () => app.close();
    const job = (await upload(app, "job", "a.md", SAMPLE_JOB)).json() as DocumentSummary;
    const res = await app.inject({ method: "GET", url: `/jobs/${job.id}/fit` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no_resume");
  });

  it("computes FitRows once, caches them, and recomputes after documents change", async () => {
    const { llm, calls } = counting();
    const { app } = await testApp({ llm });
    close = () => app.close();
    await upload(app, "resume", "cv.txt", SAMPLE_RESUME);
    const job = (await upload(app, "job", "a.md", SAMPLE_JOB)).json() as DocumentSummary;

    const first = await app.inject({ method: "GET", url: `/jobs/${job.id}/fit` });
    expect(first.statusCode).toBe(200);
    const rows = FitRow.array().parse(first.json());
    expect(rows.map((r) => [r.requirement.skill, r.status])).toEqual([
      ["TypeScript", "met"],
      ["Kubernetes", "missing"],
      ["PostgreSQL", "met"],
      ["Terraform", "met"],
    ]);
    expect(rows[0]!.evidenceChunkIds.length).toBeGreaterThan(0);

    await app.inject({ method: "GET", url: `/jobs/${job.id}/fit` });
    expect(calls.fit).toBe(1);

    await upload(app, "job", "b.md", SAMPLE_JOB);
    await app.inject({ method: "GET", url: `/jobs/${job.id}/fit` });
    expect(calls.fit).toBe(2);
  });

  it("de-duplicates concurrent requests for the same job", async () => {
    const { llm, calls } = counting();
    const { app } = await testApp({ llm });
    close = () => app.close();
    await upload(app, "resume", "cv.txt", SAMPLE_RESUME);
    const job = (await upload(app, "job", "a.md", SAMPLE_JOB)).json() as DocumentSummary;
    await Promise.all([1, 2, 3].map(() => app.inject({ method: "GET", url: `/jobs/${job.id}/fit` })));
    expect(calls.fit).toBe(1);
  });

  it("404s for unknown ids and for the resume", async () => {
    const { app } = await testApp();
    close = () => app.close();
    const resume = (await upload(app, "resume", "cv.txt", SAMPLE_RESUME)).json() as DocumentSummary;
    expect((await app.inject({ method: "GET", url: `/jobs/${resume.id}/fit` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/jobs/${crypto.randomUUID()}/fit` })).statusCode).toBe(404);
  });
});
