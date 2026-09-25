import { describe, expect, it } from "vitest";
import { detectFileType, normalizeText, parseDocument, ParseError } from "../src/lib/parse.js";
import { makeDocx, makePdf } from "./helpers.js";

describe("detectFileType", () => {
  it("accepts supported extensions whose bytes match", () => {
    expect(detectFileType("cv.PDF", Buffer.from("%PDF-1.4 ..."))).toBe("pdf");
    expect(detectFileType("cv.md", Buffer.from("# Hi"))).toBe("md");
  });

  it.each([
    ["cv.exe", Buffer.from("MZ"), /Unsupported file type/],
    ["cv.pdf", Buffer.from("not a pdf"), /not a valid PDF/],
    ["cv.docx", Buffer.from("%PDF-"), /not a valid Word/],
    ["cv.txt", Buffer.from([0x41, 0x00, 0x42]), /binary data/],
  ])("rejects %s with a helpful message", (name, bytes, message) => {
    expect(() => detectFileType(name, bytes)).toThrow(message);
  });
});

describe("normalizeText", () => {
  it("keeps paragraph breaks but collapses noise", () => {
    expect(normalizeText("a\t b  \r\n\r\n\r\n\r\nc")).toBe("a b\n\nc");
  });
});

describe("parseDocument", () => {
  const lines = ["Jane Doe", "Experience", "Built TypeScript APIs at Acme for four years."];

  it("reads plain text and markdown", async () => {
    await expect(parseDocument("a.md", Buffer.from(lines.join("\n")))).resolves.toContain("TypeScript APIs");
  });

  it("reads DOCX paragraphs", async () => {
    const text = await parseDocument("a.docx", makeDocx(lines));
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Built TypeScript APIs at Acme");
  });

  it("reads PDF text", async () => {
    const text = await parseDocument("a.pdf", makePdf(lines));
    expect(text).toContain("Jane Doe");
    expect(text).toContain("TypeScript APIs");
  });

  it("fails clearly on a corrupt DOCX", async () => {
    await expect(parseDocument("a.docx", Buffer.from("PK\u0003\u0004garbage"))).rejects.toThrow(/could not read/i);
  });

  it("fails clearly when there is no text", async () => {
    await expect(parseDocument("a.txt", Buffer.from("   "))).rejects.toBeInstanceOf(ParseError);
  });
});
