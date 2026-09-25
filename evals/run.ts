/**
 * Eval runner. For each case in golden.jsonl, against the fixtures in
 * evals/fixtures/, through the same pipeline the API serves:
 *   1. intent accuracy   router output == expectIntent
 *   2. retrieval hit@k   expectDocs all appear in the retrieved chunks, and
 *                        forbidDocs don't (i.e. job filtering worked)
 *   3. answer checks     mustMention / mustNotMention (case-insensitive)
 *   4. groundedness      share of [Cn] markers in the raw answer that point
 *                        at chunks actually in the context
 *   5. faithfulness      optional LLM judge (--judge), fast model
 *
 * Usage: pnpm eval [--real] [--judge] [--out evals/report.md]
 * Fake mode (default) needs no keys and is what CI runs. It tests plumbing;
 * --real measures answer quality with the configured models.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Intent } from "@career-intel/shared";
import { aiMode, embeddingMode, loadConfig } from "../apps/api/src/config.js";
import type { Deps } from "../apps/api/src/deps.js";
import { createEmbedder } from "../apps/api/src/lib/embeddings.js";
import { createLlm, structured } from "../apps/api/src/lib/llm.js";
import { noopTracer } from "../apps/api/src/lib/tracing.js";
import { answerQuestion, type AnswerContext } from "../apps/api/src/services/chat.js";
import { ingestDocument } from "../apps/api/src/services/ingest.js";
import { memoryStore } from "../apps/api/src/store/memory.js";

const GoldenCase = z.object({
  id: z.string(),
  question: z.string(),
  expectIntent: Intent,
  expectDocs: z.array(z.string()).default([]),
  forbidDocs: z.array(z.string()).default([]),
  mustMention: z.array(z.string()).default([]),
  mustNotMention: z.array(z.string()).default([]),
});
type GoldenCase = z.infer<typeof GoldenCase>;

export const THRESHOLDS = { intent: 0.9, retrieval: 0.9, answer: 0.8, groundedness: 0.95, faithfulness: 0.7 };

interface CaseResult {
  id: string;
  intent: string;
  intentOk: boolean;
  retrievalOk: boolean | null;
  answerOk: boolean;
  groundedness: number | null;
  faithfulness: number | null;
  notes: string[];
  answer: string;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const args = new Set(process.argv.slice(2));
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > 0 ? process.argv[outIndex + 1]! : here("./report.md");

export function checkRetrieval(c: GoldenCase, retrievedLabels: Set<string>): { ok: boolean | null; notes: string[] } {
  if (c.expectDocs.length === 0 && c.forbidDocs.length === 0) return { ok: null, notes: [] };
  const missing = c.expectDocs.filter((d) => !retrievedLabels.has(d));
  const leaked = c.forbidDocs.filter((d) => retrievedLabels.has(d));
  const notes = [
    ...(missing.length ? [`not retrieved: ${missing.join(", ")}`] : []),
    ...(leaked.length ? [`should be filtered: ${leaked.join(", ")}`] : []),
  ];
  return { ok: notes.length === 0, notes };
}

export function checkAnswer(c: GoldenCase, answer: string): { ok: boolean; notes: string[] } {
  const text = answer.toLowerCase();
  const missing = c.mustMention.filter((m) => !text.includes(m.toLowerCase()));
  const forbidden = c.mustNotMention.filter((m) => text.includes(m.toLowerCase()));
  const notes = [
    ...(missing.length ? [`missing mention: ${missing.join(", ")}`] : []),
    ...(forbidden.length ? [`forbidden mention: ${forbidden.join(", ")}`] : []),
  ];
  return { ok: notes.length === 0, notes };
}

export function groundedness(answer: string, contextRefs: Set<string>): number | null {
  const markers = [...answer.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]!);
  if (markers.length === 0) return null;
  return markers.filter((m) => contextRefs.has(m)).length / markers.length;
}

const JudgeOutput = z.object({ score: z.number().min(0).max(1), unsupportedClaims: z.array(z.string()) });

async function judge(deps: Deps, answer: string, ctx: AnswerContext): Promise<number> {
  const context = ctx.refs.map((r) => ({ ref: r.ref, text: r.text }));
  const { data } = await structured(deps.llm, {
    task: "judge",
    role: "fast",
    system:
      "You grade whether an answer is faithful to its context. Score 1 if every factual claim is supported by the context chunks, 0 if none are. List unsupported claims. Profiles are summaries of the same documents and count as support.",
    prompt: `<context>\n${context.map((c) => `<chunk ref="${c.ref}">${c.text}</chunk>`).join("\n")}\n${ctx.documents
      .filter((d) => d.profile)
      .map((d) => `<profile label="${d.label}">${JSON.stringify(d.profile)}</profile>`)
      .join("\n")}\n</context>\n\n<answer>\n${answer}\n</answer>`,
    schema: JudgeOutput,
    input: { answer, context },
  });
  return data.score;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const mark = (v: boolean | null) => (v === null ? "–" : v ? "✓" : "✗");

async function main() {
  const real = args.has("--real");
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    FAKE_AI: real ? "0" : "1",
    ...(real ? {} : { EMBEDDING_PROVIDER: "fake" }),
  });
  if (real && aiMode(config) === "fake") {
    console.error("--real needs ANTHROPIC_API_KEY (and an embedding key). Set them in the environment or .env.");
    process.exit(2);
  }
  const deps: Deps = { store: memoryStore(), llm: await createLlm(config), embedder: createEmbedder(config), tracer: noopTracer() };
  const mode = `${aiMode(config)} LLM (${deps.llm.modelFor("answer")} / ${deps.llm.modelFor("fast")}), ${embeddingMode(config)} embeddings (${deps.embedder.model})`;

  // Fixed upload order → stable labels: Resume, Job #1..#3.
  const fixtures = here("./fixtures/");
  const files = readdirSync(fixtures).sort();
  for (const name of [...files.filter((f) => f.startsWith("resume")), ...files.filter((f) => f.startsWith("job"))]) {
    await ingestDocument(deps, { kind: name.startsWith("resume") ? "resume" : "job", filename: name, bytes: readFileSync(fixtures + name) });
  }
  const labelOf = new Map((await deps.store.listDocuments()).map((d) => [d.id, d.label]));

  const cases = readFileSync(here("./golden.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => GoldenCase.parse(JSON.parse(l)));

  const results: CaseResult[] = [];
  for (const c of cases) {
    let ctx: AnswerContext | undefined;
    let answer = "";
    let intent = "";
    for await (const e of answerQuestion(deps, { historyBudgetTokens: 2000 }, { sessionId: crypto.randomUUID(), message: c.question }, { onContext: (x) => (ctx = x) })) {
      if (e.type === "intent") intent = e.intent;
      if (e.type === "token") answer += e.text;
      if (e.type === "error") answer += `[error: ${e.message}]`;
    }
    const retrieved = new Set((ctx?.refs ?? []).map((r) => labelOf.get(r.documentId) ?? "?"));
    const retrieval = checkRetrieval(c, retrieved);
    const answerCheck = checkAnswer(c, answer);
    const intentOk = intent === c.expectIntent;
    const faithfulness = args.has("--judge") && ctx && ctx.refs.length ? await judge(deps, answer, ctx) : null;
    results.push({
      id: c.id,
      intent,
      intentOk,
      retrievalOk: retrieval.ok,
      answerOk: answerCheck.ok,
      groundedness: groundedness(answer, new Set((ctx?.refs ?? []).map((r) => r.ref))),
      faithfulness,
      notes: [...(intentOk ? [] : [`intent ${intent} ≠ ${c.expectIntent}`]), ...retrieval.notes, ...answerCheck.notes],
      answer,
    });
  }

  const scored = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);
  const summary = {
    intent: mean(results.map((r) => (r.intentOk ? 1 : 0))),
    retrieval: mean(scored(results.map((r) => r.retrievalOk)).map((x) => (x ? 1 : 0))),
    answer: mean(results.map((r) => (r.answerOk ? 1 : 0))),
    groundedness: mean(scored(results.map((r) => r.groundedness))),
    faithfulness: mean(scored(results.map((r) => r.faithfulness))),
  };
  const failures = (Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]).filter(
    (k) => !Number.isNaN(summary[k]) && summary[k] < THRESHOLDS[k],
  );

  const rows = results.map((r) => [
    r.id,
    r.intent,
    mark(r.intentOk),
    mark(r.retrievalOk),
    mark(r.answerOk),
    r.groundedness === null ? "–" : pct(r.groundedness),
    r.faithfulness === null ? "–" : r.faithfulness.toFixed(2),
    r.notes.join("; "),
  ]);
  const header = ["case", "intent", "intent ok", "hit@k", "answer", "grounded", "faithful", "notes"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(`\nMode: ${mode}\n`);
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(line(r)));

  const metricRows = (Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]).map((k) => {
    const v = summary[k];
    return [k, Number.isNaN(v) ? "n/a" : pct(v), `≥ ${pct(THRESHOLDS[k])}`, Number.isNaN(v) ? "skipped" : v >= THRESHOLDS[k] ? "pass" : "FAIL"];
  });
  console.log("");
  metricRows.forEach((r) => console.log(`${r[0]!.padEnd(13)} ${r[1]!.padStart(5)}  (${r[2]})  ${r[3]}`));

  const md = [
    "# Eval report",
    "",
    `Generated by \`pnpm eval${real ? " --real" : ""}${args.has("--judge") ? " --judge" : ""}\` on ${new Date().toISOString().slice(0, 10)}.`,
    "",
    `**Mode:** ${mode}. ${real ? "" : "Fake mode checks the pipeline (routing, filtering, citations, refusals), not answer quality."}`,
    "",
    "| Metric | Score | Threshold | Result |",
    "| --- | --- | --- | --- |",
    ...metricRows.map((r) => `| ${r.join(" | ")} |`),
    "",
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
    ...rows.map((r) => "| " + r.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |"),
    "",
    "<details><summary>Answers</summary>",
    "",
    ...results.flatMap((r) => [`**${r.id}**`, "", "```text", r.answer.trim(), "```", ""]),
    "</details>",
    "",
  ].join("\n");
  writeFileSync(outPath, md);
  console.log(`\nReport written to ${outPath}`);

  if (failures.length) {
    console.error(`\nBelow threshold: ${failures.join(", ")}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
