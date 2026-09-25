import { afterEach, describe, expect, it } from "vitest";
import { DocumentDetail, DocumentSummary, type JobProfile } from "@career-intel/shared";
import type { LLM } from "../src/lib/llm.js";
import { fakeLlm } from "../src/lib/fake-llm.js";
import { makeDocx, SAMPLE_JOB, SAMPLE_RESUME, testApp, testConfig, upload } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function setup(...args: Parameters<typeof testApp>) {
  const ctx = await testApp(...args);
  close = () => ctx.app.close();
  return ctx;
}

describe("POST /documents", () => {
  it("ingests a job: chunks, embeds, extracts a profile and labels it", async () => {
    const { app, deps } = await setup();
    const res = await upload(app, "job", "platform.md", SAMPLE_JOB);
    expect(res.statusCode).toBe(201);
    const doc = DocumentSummary.parse(res.json());
    expect(doc).toMatchObject({ kind: "job", label: "Job #1", title: "Platform Engineer", filename: "platform.md" });
    expect(doc.chunkCount).toBeGreaterThan(1);

    const stored = await deps.store.getDocument(doc.id);
    expect((stored!.profile as JobProfile).requirements).toHaveLength(4);
    expect(stored!.embeddingModel).toBe("fake-hash-v1");
  });

  it("numbers jobs sequentially and replaces the previous resume", async () => {
    const { app } = await setup();
    await upload(app, "resume", "old.txt", SAMPLE_RESUME);
    await upload(app, "job", "a.md", SAMPLE_JOB);
    await upload(app, "job", "b.docx", makeDocx(SAMPLE_JOB.split("\n")));
    await upload(app, "resume", "new.txt", SAMPLE_RESUME);

    const list = (await app.inject({ method: "GET", url: "/documents" })).json() as DocumentSummary[];
    expect(list.map((d) => [d.label, d.filename])).toEqual([
      ["Job #1", "a.md"],
      ["Job #2", "b.docx"],
      ["Resume", "new.txt"],
    ]);
  });

  it.each([
    ["missing kind", "/documents", "a.md", SAMPLE_JOB, 400, "invalid_kind"],
    ["bad kind", "/documents?kind=cover_letter", "a.md", SAMPLE_JOB, 400, "invalid_kind"],
    ["unsupported type", "/documents?kind=job", "a.exe", "MZ....", 400, "invalid_file"],
    ["fake pdf", "/documents?kind=job", "a.pdf", "hello there, not a pdf", 400, "invalid_file"],
  ])("rejects %s", async (_name, url, filename, content, status, error) => {
    const { app } = await setup();
    const { multipart } = await import("./helpers.js");
    const { payload, headers } = multipart(filename, content);
    const res = await app.inject({ method: "POST", url, payload, headers });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ error });
  });

  it("enforces the upload size limit with 413", async () => {
    const { app } = await setup({}, testConfig({ UPLOAD_MAX_BYTES: "1000" }));
    const res = await upload(app, "job", "big.txt", "word ".repeat(1000));
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toMatch(/too large/i);
  });

  it("returns 422 and stores nothing when extraction keeps failing", async () => {
    const broken: LLM = { ...fakeLlm(), complete: async (req) => ({ text: "{}", usage: { task: req.task, model: "x", inputTokens: 0, outputTokens: 0, latencyMs: 0 } }) };
    const { app, deps } = await setup({ llm: broken });
    const res = await upload(app, "job", "a.md", SAMPLE_JOB);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "extraction_failed" });
    expect(await deps.store.listDocuments()).toHaveLength(0);
  });
});

describe("GET/DELETE /documents/:id", () => {
  it("returns detail with profile and chunks in reading order, then deletes", async () => {
    const { app } = await setup();
    const { id } = (await upload(app, "resume", "cv.txt", SAMPLE_RESUME)).json() as DocumentSummary;

    const detail = DocumentDetail.parse((await app.inject({ method: "GET", url: `/documents/${id}` })).json());
    expect(detail.chunks[0]!.section).toBe("header");
    expect(detail.chunks.map((c) => c.section)).toContain("skills");

    expect((await app.inject({ method: "DELETE", url: `/documents/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/documents/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/documents/${id}` })).statusCode).toBe(404);
  });

  it("rejects malformed ids", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/documents/not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });
});
