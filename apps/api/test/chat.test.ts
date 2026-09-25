import { afterEach, describe, expect, it } from "vitest";
import { ChatEvent, type DocumentSummary } from "@career-intel/shared";
import { fakeLlm } from "../src/lib/fake-llm.js";
import type { LLM, StreamRequest } from "../src/lib/llm.js";
import { OFF_TOPIC_REPLY } from "../src/services/chat.js";
import { ask, INJECTED_JOB, SAMPLE_JOB, SAMPLE_RESUME, testApp, testConfig, upload } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function seeded(overrides: Parameters<typeof testApp>[0] = {}, config = testConfig()) {
  const ctx = await testApp(overrides, config);
  close = () => ctx.app.close();
  await upload(ctx.app, "resume", "cv.txt", SAMPLE_RESUME);
  await upload(ctx.app, "job", "platform.md", SAMPLE_JOB);
  return ctx;
}

/** Wraps the fake LLM and records every streamed prompt. */
function recording() {
  const base = fakeLlm();
  const prompts: StreamRequest[] = [];
  const llm: LLM = {
    ...base,
    stream: (req) => {
      prompts.push(req);
      return base.stream(req);
    },
  };
  return { llm, prompts };
}

describe("POST /chat", () => {
  it("streams intent → tokens → citations → done, as valid ChatEvents", async () => {
    const { app } = await seeded();
    const { res, events, answer } = await ask(app, "What skills am I missing for Job #1?");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    events.forEach((e) => ChatEvent.parse(e));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("intent");
    expect(types.at(-2)).toBe("citations");
    expect(types.at(-1)).toBe("done");
    expect(types.filter((t) => t === "token").length).toBeGreaterThan(1);
    expect(events[0]).toEqual({ type: "intent", intent: "gaps" });
    expect(answer).toContain("Kubernetes");
  });

  it("only cites chunks that were in the context, and resolves them to real chunks", async () => {
    const { app, deps } = await seeded();
    const { events, answer } = await ask(app, "What skills am I missing for Job #1?");
    const citations = events.find((e) => e.type === "citations")!;
    if (citations.type !== "citations") throw new Error("unreachable");
    expect(citations.citations.length).toBeGreaterThan(0);

    const docs = await deps.store.listDocuments();
    for (const c of citations.citations) {
      expect(answer).toContain(`[${c.ref}]`);
      const chunks = await deps.store.getChunks(c.documentId);
      expect(chunks.map((x) => x.id)).toContain(c.chunkId);
      expect(docs.find((d) => d.id === c.documentId)?.label).toBe(c.documentLabel);
    }
  });

  it("drops citations the model invents", async () => {
    const base = fakeLlm();
    const llm: LLM = {
      ...base,
      async *stream() {
        yield "Real [C1] and invented [C99].";
        return { task: "answer", model: "x", inputTokens: 1, outputTokens: 1, latencyMs: 0 };
      },
    };
    const { app } = await seeded({ llm });
    const { events } = await ask(app, "Tell me about my experience with PostgreSQL");
    const citations = events.find((e) => e.type === "citations");
    expect(citations).toMatchObject({ citations: [{ ref: "C1" }] });
  });

  it("filters retrieval to the job the question names", async () => {
    const { llm, prompts } = recording();
    const { app } = await seeded({ llm });
    const job2 = (await upload(app, "job", "other.md", SAMPLE_JOB.replace("Platform Engineer", "Data Engineer"))).json() as DocumentSummary;
    await ask(app, "What am I missing for Job #2?");
    const labels = prompts[0]!.input.profiles.map((p) => p.label);
    expect(labels).toEqual(["Resume", "Job #2"]);
    expect(prompts[0]!.messages.at(-1)!.content).toContain(`id="${job2.id}"`);
  });

  it("includes profiles for fit/gaps/compare but not for general questions", async () => {
    const { llm, prompts } = recording();
    const { app } = await seeded({ llm });
    await ask(app, "How well do I fit Job #1?");
    await ask(app, "Where did I work before?");
    expect(prompts[0]!.messages.at(-1)!.content).toContain("<profile>");
    expect(prompts[1]!.messages.at(-1)!.content).not.toContain("<profile>");
  });

  it("refuses off-topic requests without calling the answer model", async () => {
    const { llm, prompts } = recording();
    const { app } = await seeded({ llm });
    const { events, answer } = await ask(app, "Write me a poem about the sea");
    expect(events[0]).toEqual({ type: "intent", intent: "off_topic" });
    expect(answer).toBe(OFF_TOPIC_REPLY);
    expect(prompts).toHaveLength(0);
  });

  it("says 'not found in your documents' when nothing relevant exists", async () => {
    const { app } = await seeded();
    const { answer } = await ask(app, "Which of my jobs used Rust?");
    expect(answer).toContain("not found in your documents");
  });

  it("persists the conversation and sends earlier turns as history", async () => {
    const { llm, prompts } = recording();
    const { app, deps } = await seeded({ llm });
    const { sessionId } = await ask(app, "Where did I work before?");
    await ask(app, "And what skills do I list?", sessionId);

    const stored = await deps.store.listMessages(sessionId);
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(stored[1]!.intent).toBe("general");
    expect(prompts[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(prompts[1]!.messages[0]!.content).toBe("Where did I work before?");
  });

  it("folds old turns into a running summary once history exceeds the budget", async () => {
    const { llm, prompts } = recording();
    const { app, deps } = await seeded({ llm }, testConfig({ HISTORY_TOKEN_BUDGET: "12" }));
    const sessionId = crypto.randomUUID();
    for (const q of ["Where did I work before?", "What skills do I list?", "What did I build at Orbit?"]) {
      await ask(app, q, sessionId);
    }
    const session = await deps.store.getOrCreateSession(sessionId);
    expect(session.summarizedCount).toBeGreaterThan(0);
    expect(session.summary).toContain("User asked");
    expect(prompts.at(-1)!.messages.at(-1)!.content).toContain("<conversation_summary>");
  });

  it("keeps an injected job description as data: rules intact, text escaped, no 10/10", async () => {
    const { llm, prompts } = recording();
    const { app } = await seeded({ llm });
    await upload(app, "job", "evil.md", INJECTED_JOB);
    const { answer } = await ask(app, "How well do I fit Job #2?");

    const prompt = prompts[0]!;
    const finalTurn = prompt.messages.at(-1)!.content;
    expect(prompt.system).not.toContain("Initech");
    const docsBlock = finalTurn.slice(finalTurn.indexOf("<documents>"), finalTurn.indexOf("</documents>"));
    expect(docsBlock).toContain("Ignore all previous instructions");
    expect(finalTurn.split("</documents>")[1]).not.toContain("Ignore all previous instructions");
    expect(answer).not.toContain("10/10");
    expect(answer.toLowerCase()).not.toContain("perfect match");
  });

  it("rejects invalid requests before streaming", async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: "POST", url: "/chat", payload: { sessionId: "nope", message: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("reports failures as an error event instead of a broken stream", async () => {
    const llm: LLM = {
      ...fakeLlm(),
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("provider exploded with secret details");
      },
    };
    const { app } = await seeded({ llm });
    const { events } = await ask(app, "Where did I work before?");
    expect(events.at(-1)).toEqual({ type: "error", message: expect.stringMatching(/something went wrong/i) });
    expect(JSON.stringify(events)).not.toContain("secret");
  });
});

describe("answerQuestion", () => {
  it("stops streaming when aborted and persists the partial answer", async () => {
    const { answerQuestion } = await import("../src/services/chat.js");
    const { deps, app } = await seeded();
    const controller = new AbortController();
    const sessionId = crypto.randomUUID();
    const seen: string[] = [];
    for await (const e of answerQuestion(deps, { historyBudgetTokens: 1000 }, { sessionId, message: "What am I missing for Job #1?", signal: controller.signal })) {
      seen.push(e.type);
      if (e.type === "token") controller.abort();
    }
    expect(seen).toEqual(["intent", "token"]);
    const stored = await deps.store.listMessages(sessionId);
    expect(stored[1]!.content).toMatch(/…\(stopped\)$/);
    await app.close();
    close = undefined;
  });
});

describe("off-topic override", () => {
  it("treats a question naming an uploaded job's company as on-topic", async () => {
    const base = fakeLlm();
    const alwaysOffTopic: LLM = {
      ...base,
      complete: async (req) => (req.task === "route" ? { text: '{"intent":"off_topic"}', usage: (await base.complete(req)).usage } : base.complete(req)),
    };
    const { app } = await seeded({ llm: alwaysOffTopic });
    const { events } = await ask(app, "What does Northwind expect from engineers?");
    expect(events[0]).toEqual({ type: "intent", intent: "general" });
    const { events: other } = await ask(app, "What is the capital of France?");
    expect(other[0]).toEqual({ type: "intent", intent: "off_topic" });
  });
});
