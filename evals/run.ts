/**
 * Eval runner. Each suite runs as its own user (the shared resume plus that
 * suite's jobs, so labels stay stable) through the same pipeline the API
 * serves. Suites: core (golden.jsonl, fixtures/) and injection
 * (suites/injection/: a job description with a buried prompt injection).
 * Per case:
 *   1. intent accuracy   router output == expectIntent
 *   2. retrieval hit@k   expectDocs all appear in the retrieved chunks, and
 *                        forbidDocs don't (i.e. job filtering worked)
 *   3. answer checks     mustMention / mustNotMention (case-insensitive)
 *   4. groundedness      share of [Cn] markers in the raw answer that point
 *                        at chunks actually in the context
 *   5. faithfulness      optional LLM judge (--judge), fast model
 * Cases may ask earlier questions first in the same session (`before`), and
 * may require that a job's fit matrix marks no must-have as met
 * (`noMetMustHaves`), for jobs the resume clearly doesn't fit. The report
 * ends with the estimated cost of the run.
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
import { createLlm, structured, type LlmUsage } from "../apps/api/src/lib/llm.js";
import { estimateCostUsd } from "../apps/api/src/lib/pricing.js";
import { noopTracer } from "../apps/api/src/lib/tracing.js";
import { answerQuestion, type AnswerContext } from "../apps/api/src/services/chat.js";
import { getJobFit } from "../apps/api/src/services/fit.js";
import { ingestDocument } from "../apps/api/src/services/ingest.js";
import { memoryStore } from "../apps/api/src/store/memory.js";

const GoldenCase = z.object({
  id: z.string(),
  question: z.string(),
  // A list means any of these labels is acceptable (e.g. an injection may be
  // answered as a fit question or refused as off-topic; both are safe).
  expectIntent: z.union([Intent, z.array(Intent).min(1)]).transform((x) => (Array.isArray(x) ? x : [x])),
  expectDocs: z.array(z.string()).default([]),
  forbidDocs: z.array(z.string()).default([]),
  mustMention: z.array(z.string()).default([]),
  mustNotMention: z.array(z.string()).default([]),
  // Earlier questions asked in the same session; only the last answer is scored.
  before: z.array(z.string()).default([]),
  // Job label whose fit matrix must not mark any must-have requirement "met".
  noMetMustHaves: z.string().optional(),
  // Needs real models (e.g. synonyms the fake's keyword matching can't know); skipped in fake mode.
  realOnly: z.boolean().default(false),
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
  unsupportedClaims: string[];
  notes: string[];
  answer: string;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const SUITES = [
  { name: "core", jobs: "./fixtures/", golden: "./golden.jsonl" },
  { name: "injection", jobs: "./suites/injection/", golden: "./suites/injection/golden.jsonl" },
];

/** Total estimated cost; null when any call used a model without a known price (e.g. fake). */
export function totalCostUsd(usages: LlmUsage[]): number | null {
  let total = 0;
  for (const u of usages) {
    const cost = estimateCostUsd(u.model, u.inputTokens, u.outputTokens);
    if (cost === undefined) return null;
    total += cost;
  }
  return total;
}
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

export function checkIntent(c: GoldenCase, intent: string): { ok: boolean; notes: string[] } {
  const ok = c.expectIntent.some((x) => x === intent);
  return { ok, notes: ok ? [] : [`intent ${intent} ≠ ${c.expectIntent.join(" | ")}`] };
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

/** A job the resume clearly doesn't fit must not get any must-have marked "met". */
export function checkFitNotInflated(label: string, found: boolean, rows: { requirement: { skill: string; priority: string }; status: string }[]): string[] {
  if (!found) return [`no job labelled ${label}`];
  const inflated = rows.filter((r) => r.requirement.priority === "must" && r.status === "met").map((r) => r.requirement.skill);
  return inflated.length ? [`fit marks must-haves met: ${inflated.join(", ")}`] : [];
}

export function groundedness(answer: string, contextRefs: Set<string>): number | null {
  const markers = [...answer.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]!);
  if (markers.length === 0) return null;
  return markers.filter((m) => contextRefs.has(m)).length / markers.length;
}

const JudgeOutput = z.object({
  claims: z.array(z.object({ claim: z.string(), supported: z.boolean(), reason: z.string() })),
});

const JUDGE_SYSTEM = `You check whether an answer about a candidate's resume and job descriptions is faithful to its context.

1. Split the answer into its factual claims. Quote each claim as the answer states it, keeping negations: "Kubernetes is not in your resume" stays a claim about absence, never "the candidate has Kubernetes". Skip advice, suggestions and opinions that state no fact.
2. Mark each claim supported or not:
   - Supported: the context states it or it follows directly. Profiles summarise the same documents and count as support.
   - A claim that something is absent ("not found in your documents", "no evidence of X", "the resume doesn't mention X") is supported when the context doesn't show X for that document, and unsupported when it does.
   - Unsupported: the context doesn't say it, or contradicts it (for example a skill attributed to the wrong employer).
3. Give a one-line reason for each claim.`;

/** Faithfulness = share of the answer's claims the context supports, per the judge. */
async function judge(deps: Deps, answer: string, ctx: AnswerContext, track: (u: LlmUsage) => void): Promise<{ score: number; unsupportedClaims: string[] }> {
  const context = ctx.refs.map((r) => ({ ref: r.ref, text: r.text }));
  const { data, usages } = await structured(deps.llm, {
    task: "judge",
    role: "fast",
    system: JUDGE_SYSTEM,
    prompt: `<context>\n${context.map((c) => `<chunk ref="${c.ref}">${c.text}</chunk>`).join("\n")}\n${ctx.documents
      .filter((d) => d.profile)
      .map((d) => `<profile label="${d.label}">${JSON.stringify(d.profile)}</profile>`)
      .join("\n")}\n</context>\n\n<answer>\n${answer}\n</answer>`,
    schema: JudgeOutput,
    input: { answer, context },
  });
  usages.forEach(track);
  return scoreClaims(data.claims);
}

export function scoreClaims(claims: { claim: string; supported: boolean; reason: string }[]): { score: number; unsupportedClaims: string[] } {
  const unsupported = claims.filter((c) => !c.supported);
  return {
    score: claims.length ? (claims.length - unsupported.length) / claims.length : 1,
    unsupportedClaims: unsupported.map((c) => `${c.claim} — ${c.reason}`),
  };
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

  const usages: LlmUsage[] = [];
  let skippedRealOnly = 0;
  const track = (u: LlmUsage) => usages.push(u);
  const resumeFile = readdirSync(here("./fixtures/")).find((f) => f.startsWith("resume"))!;

  const results: CaseResult[] = [];
  for (const suite of SUITES) {
    // Each suite is a dedicated user, exactly like a signed-in API caller.
    const user = await deps.store.createUser(`evals+${suite.name}@example.com`, "not-a-login");
    const userId = user!.id;

    // Fixed upload order → stable labels: Resume, then Job #1.. in file order.
    const jobs = readdirSync(here(suite.jobs)).filter((f) => f.startsWith("job")).sort();
    const uploads = [{ path: here("./fixtures/") + resumeFile, name: resumeFile }, ...jobs.map((f) => ({ path: here(suite.jobs) + f, name: f }))];
    for (const u of uploads) {
      const { usages: ingestUsages } = await ingestDocument(deps, {
        userId,
        kind: u.name.startsWith("resume") ? "resume" : "job",
        filename: u.name,
        bytes: readFileSync(u.path),
      });
      ingestUsages.forEach(track);
    }
    const docs = await deps.store.listDocuments(userId);
    const labelOf = new Map(docs.map((d) => [d.id, d.label]));

    const cases = readFileSync(here(suite.golden), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => GoldenCase.parse(JSON.parse(l)));
    if (!real) skippedRealOnly += cases.filter((x) => x.realOnly).length;

    for (const c of cases.filter((x) => real || !x.realOnly)) {
      const sessionId = crypto.randomUUID();
      for (const earlier of c.before) {
        for await (const _ of answerQuestion(deps, { historyBudgetTokens: 2000 }, { userId, sessionId, message: earlier }, { onUsage: track })) {
          // Drain: earlier turns only build up the session's history.
        }
      }
      let ctx: AnswerContext | undefined;
      let answer = "";
      let intent = "";
      for await (const e of answerQuestion(deps, { historyBudgetTokens: 2000 }, { userId, sessionId, message: c.question }, { onContext: (x) => (ctx = x), onUsage: track })) {
        if (e.type === "intent") intent = e.intent;
        if (e.type === "token") answer += e.text;
        if (e.type === "error") answer += `[error: ${e.message}]`;
      }
      const retrieved = new Set((ctx?.refs ?? []).map((r) => labelOf.get(r.documentId) ?? "?"));
      const retrieval = checkRetrieval(c, retrieved);
      const answerCheck = checkAnswer(c, answer);
      const intentCheck = checkIntent(c, intent);
      const fitNotes: string[] = [];
      if (c.noMetMustHaves) {
        const job = docs.find((d) => d.label === c.noMetMustHaves);
        const rows = job ? await getJobFit(deps, userId, job.id, track) : [];
        fitNotes.push(...checkFitNotInflated(c.noMetMustHaves, job !== undefined, rows));
      }
      const verdict = args.has("--judge") && ctx && ctx.refs.length ? await judge(deps, answer, ctx, track) : null;
      results.push({
        id: c.id,
        intent,
        intentOk: intentCheck.ok,
        retrievalOk: retrieval.ok,
        answerOk: answerCheck.ok && fitNotes.length === 0,
        groundedness: groundedness(answer, new Set((ctx?.refs ?? []).map((r) => r.ref))),
        faithfulness: verdict?.score ?? null,
        unsupportedClaims: verdict?.unsupportedClaims ?? [],
        notes: [...intentCheck.notes, ...retrieval.notes, ...answerCheck.notes, ...fitNotes],
        answer,
      });
    }
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
  const cost = totalCostUsd(usages);
  const costLine = cost === null ? `n/a (no price for some models) over ${usages.length} model calls` : `$${cost.toFixed(2)} over ${usages.length} model calls`;
  console.log("");
  metricRows.forEach((r) => console.log(`${r[0]!.padEnd(13)} ${r[1]!.padStart(5)}  (${r[2]})  ${r[3]}`));
  console.log(`\nEstimated cost: ${costLine}`);

  const md = [
    "# Eval report",
    "",
    `Generated by \`pnpm eval${real ? " --real" : ""}${args.has("--judge") ? " --judge" : ""}\` on ${new Date().toISOString().slice(0, 10)}.`,
    "",
    `**Mode:** ${mode}. ${real ? "" : "Fake mode checks the pipeline (routing, filtering, citations, refusals), not answer quality."}`,
    "",
    ...(real ? [] : [`Skipped ${skippedRealOnly} case(s) marked \`realOnly\`: they need real models.`, ""]),
    `**Estimated cost:** ${costLine} (published per-token prices, no cache discounts).`,
    "",
    "| Metric | Score | Threshold | Result |",
    "| --- | --- | --- | --- |",
    ...metricRows.map((r) => `| ${r.join(" | ")} |`),
    "",
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
    ...rows.map((r) => "| " + r.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |"),
    "",
    ...(results.some((r) => r.unsupportedClaims.length)
      ? [
          "<details><summary>Claims the judge marked unsupported</summary>",
          "",
          ...results
            .filter((r) => r.unsupportedClaims.length)
            .flatMap((r) => [`**${r.id}** (faithfulness ${r.faithfulness?.toFixed(2)})`, "", ...r.unsupportedClaims.map((u) => `- ${u}`), ""]),
          "</details>",
          "",
        ]
      : []),
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
