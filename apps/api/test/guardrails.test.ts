import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ask, SAMPLE_JOB, SAMPLE_RESUME, testConfig, testDeps, upload } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => lines.join("") };
}

describe("rate limiting", () => {
  it("limits /chat separately and answers 429 in the ApiError shape", async () => {
    const app = await buildApp(testConfig({ CHAT_RATE_LIMIT_PER_MINUTE: "2" }), testDeps());
    close = () => app.close();
    const payload = { sessionId: crypto.randomUUID(), message: "What are my skills?" };
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "POST", url: "/chat", payload })).statusCode).toBe(200);
    const res = await app.inject({ method: "POST", url: "/chat", payload });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: "rate_limited", message: expect.stringMatching(/try again/) });
  });

  it("applies a global limit but never to health checks", async () => {
    const app = await buildApp(testConfig({ RATE_LIMIT_PER_MINUTE: "2" }), testDeps());
    close = () => app.close();
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: "GET", url: "/documents" })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("logging", () => {
  const SENTINEL = "ZEBRAQUARTZ-SENTINEL";
  const SECRET = "sk-ant-api03-DO-NOT-LOG-ME";

  it("logs structured lines with request ids but never document text or keys", async () => {
    const logs = captureLogs();
    const config = testConfig({ ANTHROPIC_API_KEY: SECRET, LOG_LEVEL: "debug" });
    const app = await buildApp(config, testDeps(), { logStream: logs.stream });
    close = () => app.close();

    await upload(app, "resume", "cv.txt", `${SAMPLE_RESUME}\n\nProjects\nBuilt ${SENTINEL} pipeline.`);
    await upload(app, "job", "job.md", SAMPLE_JOB);
    await app.inject({ method: "GET", url: "/documents", headers: { authorization: `Bearer ${SECRET}` } });
    await ask(app, `Tell me about the ${SENTINEL} project`);

    const text = logs.text();
    const entries = text.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.some((e) => e.msg === "document ingested")).toBe(true);
    const chat = entries.find((e) => e.msg === "chat answered")!;
    expect(chat).toMatchObject({ intent: "general", reqId: expect.any(String), traceId: expect.any(String) });
    expect(chat).toHaveProperty("inputTokens");
    expect(chat).toHaveProperty("latencyMs");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(SECRET);
  });

  it("does not leak query parameters (document text) from database errors", async () => {
    const logs = captureLogs();
    const deps = testDeps();
    deps.store.insertDocument = async () => {
      const err = new Error(`Failed query: insert into chunks ...\nparams: ${SENTINEL}`);
      err.name = "DrizzleQueryError";
      Object.assign(err, { params: [SENTINEL], cause: Object.assign(new Error("connection terminated"), { code: "57P01" }) });
      throw err;
    };
    const app = await buildApp(testConfig(), deps, { logStream: logs.stream });
    close = () => app.close();

    const res = await upload(app, "resume", "cv.txt", SAMPLE_RESUME);
    expect(res.statusCode).toBe(500);
    expect(res.json().message).not.toContain(SENTINEL);
    expect(logs.text()).toContain("connection terminated");
    expect(logs.text()).not.toContain(SENTINEL);
  });

  it("propagates a caller's x-request-id and generates one otherwise", async () => {
    const app = await buildApp(testConfig(), testDeps());
    close = () => app.close();
    const given = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "trace-abc-12345" } });
    expect(given.headers["x-request-id"]).toBe("trace-abc-12345");
    const generated = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "bad id!" } });
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("request size", () => {
  it("rejects oversized JSON bodies", async () => {
    const app = await buildApp(testConfig(), testDeps());
    close = () => app.close();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { sessionId: crypto.randomUUID(), message: "x".repeat(100_000) },
    });
    expect(res.statusCode).toBe(413);
  });

  it("rejects over-long questions", async () => {
    const app = await buildApp(testConfig(), testDeps());
    close = () => app.close();
    const res = await app.inject({ method: "POST", url: "/chat", payload: { sessionId: crypto.randomUUID(), message: "x".repeat(2001) } });
    expect(res.statusCode).toBe(400);
  });
});
