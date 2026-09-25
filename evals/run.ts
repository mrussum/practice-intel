/**
 * Eval runner (stub). Filled in on day 6.
 *
 * For each case in golden.jsonl, against fixtures in evals/fixtures/:
 *   1. intent accuracy        — router output == expectIntent
 *   2. retrieval hit rate     — expected docs appear in top-k chunks
 *   3. answer checks          — mustMention / mustNotMention substrings
 *   4. groundedness           — every citation id exists in retrieved context
 *   5. (optional) LLM judge   — faithfulness score, Haiku as judge
 *
 * Prints a table and exits non-zero below thresholds, so CI can gate on it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("./golden.jsonl", import.meta.url));
const cases = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { id: string; question: string });

console.log(`Loaded ${cases.length} eval cases. Runner not implemented yet.`);
for (const c of cases) console.log(`- ${c.id}: ${c.question}`);
