import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmUsage } from "../src/lib/llm.js";
import { estimateCostUsd } from "../src/lib/pricing.js";
import { noopTracer, type Tracer } from "../src/lib/tracing.js";
import { ask, SAMPLE_JOB, SAMPLE_RESUME, testApp, upload } from "./helpers.js";

const calls: { method: string; args: unknown }[] = [];
vi.mock("langfuse", () => ({
  Langfuse: class {
    trace(args: { id?: string }) {
      calls.push({ method: "trace", args });
      return {
        id: args.id ?? "generated",
        span: (a: unknown) => (calls.push({ method: "span", args: a }), { end: (o: unknown) => calls.push({ method: "span.end", args: o }) }),
        generation: (a: unknown) => calls.push({ method: "generation", args: a }),
        update: (a: unknown) => calls.push({ method: "update", args: a }),
      };
    }
    async shutdownAsync() {}
  },
}));

const usage = (over: Partial<LlmUsage> = {}): LlmUsage => ({
  task: "answer",
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 500,
  latencyMs: 1200,
  ...over,
});

describe("estimateCostUsd", () => {
  it("prices known models per million tokens", () => {
    expect(estimateCostUsd("claude-sonnet-5", 1_000_000, 0)).toBe(2);
    expect(estimateCostUsd("claude-haiku-4-5", 1000, 1000)).toBeCloseTo(0.006, 9);
  });

  it("returns undefined for unknown models rather than guessing", () => {
    expect(estimateCostUsd("fake", 10, 10)).toBeUndefined();
  });
});

describe("noopTracer", () => {
  it("still totals tokens and cost for logs", () => {
    const trace = noopTracer().startTrace("chat", { id: "t1" });
    trace.generation(usage());
    trace.generation(usage({ model: "claude-haiku-4-5", inputTokens: 200, outputTokens: 10 }));
    const totals = trace.end();
    expect(trace.id).toBe("t1");
    expect(totals).toMatchObject({ inputTokens: 1200, outputTokens: 510, costUsd: 0.00725 });
  });
});

describe("langfuseTracer", () => {
  afterEach(() => void (calls.length = 0));

  it("sends one trace with spans and priced generations", async () => {
    const { langfuseTracer } = await import("../src/lib/tracing.js");
    const tracer = langfuseTracer({ publicKey: "pk", secretKey: "sk" });
    const trace = tracer.startTrace("chat", { id: "req-1", sessionId: "s1", input: { question: "q" } });
    trace.span("retrieve").end({ chunks: 3 });
    trace.generation(usage());
    trace.end({ intent: "fit" });

    expect(calls[0]).toEqual({ method: "trace", args: { id: "req-1", name: "chat", sessionId: "s1", input: { question: "q" } } });
    expect(calls.find((c) => c.method === "span")?.args).toMatchObject({ name: "retrieve" });
    expect(calls.find((c) => c.method === "generation")?.args).toMatchObject({
      name: "answer",
      model: "claude-sonnet-5",
      usageDetails: { input: 1000, output: 500 },
      costDetails: { total: 0.007 },
    });
    expect(calls.at(-1)).toMatchObject({ method: "update", args: { output: { intent: "fit", costUsd: 0.007 } } });
  });
});

describe("chat tracing", () => {
  it("records route, retrieve and generate steps and returns the trace id in done", async () => {
    const spans: string[] = [];
    const tasks: string[] = [];
    const base = noopTracer();
    const tracer: Tracer = {
      ...base,
      startTrace(name, opts) {
        const t = base.startTrace(name, opts);
        return {
          ...t,
          id: t.id,
          span: (n) => (spans.push(n), t.span(n)),
          generation: (u) => (tasks.push(u.task), t.generation(u)),
        };
      },
    };
    const { app } = await testApp({ tracer });
    await upload(app, "resume", "cv.txt", SAMPLE_RESUME);
    await upload(app, "job", "a.md", SAMPLE_JOB);
    spans.length = 0;
    tasks.length = 0;

    const { events, res } = await ask(app, "What am I missing for Job #1?");
    expect(spans).toEqual(["route", "retrieve", "generate"]);
    expect(tasks).toEqual(["route", "answer"]);
    expect(events.at(-1)).toEqual({ type: "done", traceId: res.headers["x-request-id"] });
    await app.close();
  });
});
