/**
 * Small lexical helpers shared by the in-memory store, the fake embedder and
 * the fake LLM. Deliberately naive: they only need to be deterministic and
 * roughly sensible, not state of the art.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from has have how i if in into is it its " +
    "me my of on or our so than that the their them then there these they this to was we " +
    "were what when where which who why will with would you your am im about any all should " +
    "could tell give list show which whats"
  ).split(" "),
);

/** Lowercase word tokens without stopwords. "Node.js" → ["node", "js"]. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** Rough token estimate (≈4 chars per token for English). Good enough for budgets. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** First `max` characters on a word boundary, with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max)}…`;
}
