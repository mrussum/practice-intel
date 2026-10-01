import { describe, expect, it } from "vitest";
import { resolveMentions, type MentionableDoc } from "../src/lib/mentions.js";

const docs: MentionableDoc[] = [
  { id: "r", kind: "resume", label: "Resume", title: "Alex Rivera", profile: { skills: [] } },
  { id: "j1", kind: "job", label: "Job #1", title: "Platform Engineer", profile: { title: "Platform Engineer", company: "Northwind", requirements: [] } },
  { id: "j2", kind: "job", label: "Job #2", title: "Data Analyst", profile: { title: "Data Analyst", company: "Globex", requirements: [] } },
  { id: "j12", kind: "job", label: "Job #12", title: "Go Developer", profile: { title: "Go Developer", requirements: [] } },
];

describe("resolveMentions", () => {
  it.each([
    ["What am I missing for Job #2?", ["j2"]],
    ["compare job 1 and job2", ["j1", "j2"]],
    ["how do I fit the platform engineer role", ["j1"]],
    ["Would Globex hire me?", ["j2"]],
    ["job #12 please", ["j12"]],
    ["What are my strengths?", []],
    ["Tell me about the resume", []],
  ])("%s → %j", (message, ids) => {
    expect(resolveMentions(message, docs)).toEqual(ids);
  });

  it("matches whole numbers and words only", () => {
    expect(resolveMentions("job #1", docs)).toEqual(["j1"]); // not Job #12
    expect(resolveMentions("I love globexcellence", docs)).toEqual([]);
  });
});
