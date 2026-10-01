import { describe, expect, it } from "vitest";
import { fakeLlm } from "../src/lib/fake-llm.js";
import type { LLM } from "../src/lib/llm.js";
import { routeIntent } from "../src/lib/router.js";

describe("routeIntent", () => {
  it("uses the fast model with a structured schema and wraps the message", async () => {
    const seen: { role: string; prompt: string; jsonSchema?: unknown }[] = [];
    const base = fakeLlm();
    const spy: LLM = { ...base, complete: async (req) => (seen.push(req), base.complete(req)) };

    const out = await routeIntent(spy, "What am I missing for Job #1?", ["Resume", "Job #1"]);
    expect(out.intent).toBe("gaps");
    expect(seen[0]!.role).toBe("fast");
    expect(seen[0]!.prompt).toContain("<message>\nWhat am I missing for Job #1?\n</message>");
    expect(seen[0]!.prompt).toContain("Resume, Job #1");
    expect(JSON.stringify(seen[0]!.jsonSchema)).toContain("off_topic");
  });
});
