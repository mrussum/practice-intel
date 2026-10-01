import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmError, structured, type LLM } from "../src/lib/llm.js";

/** An LLM that replays canned responses, recording the prompts it saw. */
function scripted(responses: string[]) {
  const prompts: string[] = [];
  const llm: LLM = {
    mode: "fake",
    modelFor: () => "scripted",
    complete: vi.fn(async (req) => {
      prompts.push(req.prompt);
      const text = responses.shift() ?? "";
      return { text, usage: { task: req.task, model: "scripted", inputTokens: 1, outputTokens: 1, latencyMs: 0 } };
    }),
    stream: async function* () {
      return { task: "answer", model: "scripted", inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    },
  };
  return { llm, prompts };
}

const Schema = z.object({ intent: z.enum(["fit", "gaps"]) });
const req = { task: "route" as const, role: "fast" as const, system: "s", prompt: "p", schema: Schema, input: { message: "", documentLabels: [] } };

describe("structured", () => {
  it("returns validated data on the first valid response", async () => {
    const { llm } = scripted(['{"intent":"fit"}']);
    const out = await structured(llm, req);
    expect(out.data).toEqual({ intent: "fit" });
    expect(out.usages).toHaveLength(1);
  });

  it("repairs once, showing the model its validation error", async () => {
    const { llm, prompts } = scripted(['{"intent":"vibes"}', '{"intent":"gaps"}']);
    const out = await structured(llm, req);
    expect(out.data).toEqual({ intent: "gaps" });
    expect(prompts[1]).toContain("did not match the required schema");
    expect(prompts[1]).toContain("intent");
  });

  it("fails clearly after the repair attempt also fails", async () => {
    const { llm } = scripted(["not json", '{"intent":1}']);
    await expect(structured(llm, req)).rejects.toThrow(LlmError);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});
