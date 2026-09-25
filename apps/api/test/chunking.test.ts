import { describe, expect, it } from "vitest";
import { chunkByStructure, detectHeading } from "../src/lib/chunking.js";

describe("detectHeading", () => {
  it.each([
    ["Experience", "experience"],
    ["## Work Experience", "experience"],
    ["Requirements:", "requirements"],
    ["Nice to have", "nice_to_have"],
  ])("maps %s -> %s", (line, expected) => {
    expect(detectHeading(line)).toBe(expected);
  });

  it("ignores ordinary sentences", () => {
    expect(detectHeading("Built a RAG pipeline serving 2k users a day")).toBeNull();
  });
});

describe("chunkByStructure", () => {
  const resume = `Jane Doe
jane@example.com

Experience
Acme Ltd — Engineer (2022–2024)
Built TypeScript APIs.

Beta Co — Intern (2021)
Wrote tests.

Skills
TypeScript, Postgres, AWS`;

  it("keeps each experience entry as its own chunk, tagged by section", () => {
    const chunks = chunkByStructure(resume, 60);
    const experience = chunks.filter((c) => c.section === "experience");
    expect(experience).toHaveLength(2);
    expect(experience[0]!.text).toContain("Acme");
    expect(chunks.find((c) => c.section === "skills")?.text).toContain("Postgres");
  });

  it("puts pre-heading content in a header chunk", () => {
    expect(chunkByStructure(resume)[0]).toMatchObject({ section: "header" });
  });

  it("returns nothing for empty input", () => {
    expect(chunkByStructure("   \n\n ")).toEqual([]);
  });
});
