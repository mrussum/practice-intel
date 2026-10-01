/**
 * USD per million tokens, from Anthropic's published pricing table
 * (checked 2026-09). Estimates only: they ignore prompt-cache discounts, and
 * an unknown model returns undefined rather than a wrong number.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
