import { describe, expect, it } from "vitest";
import { trimHistory, type Turn } from "../src/lib/history.js";

const turns = (n: number, size = 40): Turn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `${i}`.padEnd(size, ".") }));

describe("trimHistory", () => {
  it("keeps everything when it fits", () => {
    const h = turns(4);
    expect(trimHistory(h, { budgetTokens: 1000, maxMessages: 10 })).toEqual({ kept: h, overflow: [] });
  });

  it("keeps the last N messages and overflows the rest", () => {
    const h = turns(10);
    const { kept, overflow } = trimHistory(h, { budgetTokens: 1000, maxMessages: 4 });
    expect(kept.map((t) => t.content[0])).toEqual(["6", "7", "8", "9"]);
    expect(overflow).toHaveLength(6);
  });

  it("respects the token budget (40 chars ≈ 10 tokens each)", () => {
    const { kept } = trimHistory(turns(10), { budgetTokens: 25, maxMessages: 10 });
    expect(kept).toHaveLength(2);
  });

  it("never starts the kept window with an assistant message", () => {
    const { kept, overflow } = trimHistory(turns(6), { budgetTokens: 1000, maxMessages: 3 });
    expect(kept[0]!.role).toBe("user");
    expect(kept).toHaveLength(2);
    expect(overflow).toHaveLength(4);
  });
});
