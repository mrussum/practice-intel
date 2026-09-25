import { describe, expect, it } from "vitest";
import { fakeExtractJob, fakeExtractResume, fakeRoute, skillOf } from "../src/lib/fake-llm.js";
import { SAMPLE_JOB, SAMPLE_RESUME } from "./helpers.js";

describe("fake extraction", () => {
  it.each([
    ["- Kubernetes: operating clusters", "Kubernetes"],
    ["- 5+ years of experience with Go in production", "Go in production"],
    ["* Strong knowledge of distributed systems, ideally Kafka", "distributed systems"],
  ])("skillOf(%s) = %s", (line, skill) => {
    expect(skillOf(line)).toBe(skill);
  });

  it("splits job requirements into must and nice", () => {
    const job = fakeExtractJob(SAMPLE_JOB);
    expect(job.title).toBe("Platform Engineer");
    expect(job.company).toBe("Northwind");
    expect(job.requirements.map((r) => [r.skill, r.priority])).toEqual([
      ["TypeScript", "must"],
      ["Kubernetes", "must"],
      ["PostgreSQL", "must"],
      ["Terraform", "nice"],
    ]);
  });

  it("finds resume skills with supporting evidence", () => {
    const resume = fakeExtractResume(SAMPLE_RESUME);
    expect(resume.name).toBe("Alex Rivera");
    const pg = resume.skills.find((s) => s.skill === "PostgreSQL");
    expect(pg?.evidence).toMatch(/migration from MySQL to PostgreSQL/);
  });
});

describe("fakeRoute", () => {
  it.each([
    ["What skills am I missing for Job #1?", "gaps"],
    ["How well do I fit Job #2?", "fit"],
    ["Compare the three jobs for me", "compare"],
    ["What interview questions might they ask?", "interview_prep"],
    ["Where did I work in 2022?", "general"],
    ["Write me a poem about the sea", "off_topic"],
  ])("%s → %s", (message, intent) => {
    expect(fakeRoute(message)).toBe(intent);
  });
});
