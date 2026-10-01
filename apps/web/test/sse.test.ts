import { describe, expect, it } from "vitest";
import { createSseParser } from "../src/lib/sse";

const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

describe("createSseParser", () => {
  it("parses several events delivered in one chunk", () => {
    const p = createSseParser();
    const events = p.feed(frame({ type: "intent", intent: "gaps" }) + frame({ type: "token", text: "Hi" }) + frame({ type: "done" }));
    expect(events).toEqual([{ type: "intent", intent: "gaps" }, { type: "token", text: "Hi" }, { type: "done" }]);
  });

  it("reassembles a frame split across chunks at any byte", () => {
    const whole = frame({ type: "token", text: "Kubernetes [C1]" }) + frame({ type: "done", traceId: "t" });
    for (let cut = 1; cut < whole.length; cut++) {
      const p = createSseParser();
      const events = [...p.feed(whole.slice(0, cut)), ...p.feed(whole.slice(cut))];
      expect(events, `cut at ${cut}`).toEqual([{ type: "token", text: "Kubernetes [C1]" }, { type: "done", traceId: "t" }]);
    }
  });

  it("preserves whitespace and newlines inside token text", () => {
    const p = createSseParser();
    expect(p.feed(frame({ type: "token", text: " a\n- b " }))).toEqual([{ type: "token", text: " a\n- b " }]);
  });

  it("handles CRLF line endings", () => {
    const p = createSseParser();
    expect(p.feed(`data: {"type":"done"}\r\n\r\n`)).toEqual([{ type: "done" }]);
  });

  it("drops malformed JSON and events that don't match the ChatEvent schema", () => {
    const p = createSseParser();
    const events = p.feed(
      "data: {not json\n\n" + frame({ type: "token" }) + frame({ type: "mystery" }) + ": keep-alive comment\n\n" + frame({ type: "done" }),
    );
    expect(events).toEqual([{ type: "done" }]);
  });

  it("waits for the blank line before emitting", () => {
    const p = createSseParser();
    expect(p.feed('data: {"type":"done"}\n')).toEqual([]);
    expect(p.feed("\n")).toEqual([{ type: "done" }]);
  });
});
