import { estimateTokens } from "./text.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Keeps the most recent messages that fit both `maxMessages` and
 * `budgetTokens`. Everything older is returned as `overflow`, to be folded
 * into the running summary. The kept window always starts with a user message,
 * because the Messages API requires the first turn to be the user's.
 */
export function trimHistory(
  history: Turn[],
  opts: { budgetTokens: number; maxMessages: number },
): { kept: Turn[]; overflow: Turn[] } {
  let start = history.length;
  let used = 0;
  while (start > 0 && history.length - start < opts.maxMessages) {
    const cost = estimateTokens(history[start - 1]!.content);
    if (used + cost > opts.budgetTokens) break;
    used += cost;
    start--;
  }
  while (start < history.length && history[start]!.role !== "user") start++;
  return { kept: history.slice(start), overflow: history.slice(0, start) };
}
