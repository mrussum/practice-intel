/**
 * Fit-matrix accuracy against hand labels. evals/fit-labels.json holds the
 * owner's own met / partial / missing judgement of the fixture resume
 * against every requirement. This runs the real fit service over the
 * fixtures and reports exact-match accuracy, plus the dangerous error: a
 * requirement labelled "missing" that the app calls "met".
 *
 * Usage: pnpm eval:fit [--real] [--out evals/fit-report.md]
 * Requirements are matched to labels by skill name, because the extraction
 * step names them; unmatched ones are listed rather than guessed.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FitStatus } from "@career-intel/shared";
import { aiMode, embeddingMode, loadConfig } from "../apps/api/src/config.js";
import type { Deps } from "../apps/api/src/deps.js";
import { createEmbedder } from "../apps/api/src/lib/embeddings.js";
import { createLlm, type LlmUsage } from "../apps/api/src/lib/llm.js";
import { noopTracer } from "../apps/api/src/lib/tracing.js";
import { getJobFit } from "../apps/api/src/services/fit.js";
import { ingestDocument } from "../apps/api/src/services/ingest.js";
import { memoryStore } from "../apps/api/src/store/memory.js";
import { totalCostUsd } from "./run.js";

const Label = z.object({
  skill: z.string(),
  priority: z.enum(["must", "nice"]),
  requirement: z.string(),
  label: z.union([FitStatus, z.literal("TODO")]),
});
const LabelsFile = z.record(z.string(), z.union([z.string(), z.array(Label)]));
type Status = z.infer<typeof FitStatus>;

export interface Prediction {
  skill: string;
  status: Status;
}

export interface FitScore {
  compared: number;
  correct: number;
  /** Labelled missing, predicted met: the error that would mislead a candidate. */
  missingCalledMet: string[];
  confusion: Record<Status, Record<Status, number>>;
  unmatchedLabels: string[];
  unlabelledPredictions: string[];
  todo: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sameSkill = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)];
  return x === y || (x.length >= 2 && y.length >= 2 && (x.startsWith(y) || y.startsWith(x)));
};

export function scoreFit(labels: { skill: string; label: Status | "TODO" }[], predictions: Prediction[]): FitScore {
  const statuses = FitStatus.options;
  const confusion = Object.fromEntries(statuses.map((l) => [l, Object.fromEntries(statuses.map((p) => [p, 0]))])) as FitScore["confusion"];
  const score: FitScore = { compared: 0, correct: 0, missingCalledMet: [], confusion, unmatchedLabels: [], unlabelledPredictions: [], todo: 0 };
  const used = new Set<number>();
  for (const l of labels) {
    if (l.label === "TODO") {
      score.todo++;
      continue;
    }
    const i = predictions.findIndex((p, idx) => !used.has(idx) && sameSkill(p.skill, l.skill));
    if (i < 0) {
      score.unmatchedLabels.push(l.skill);
      continue;
    }
    used.add(i);
    const predicted = predictions[i]!.status;
    score.compared++;
    if (predicted === l.label) score.correct++;
    if (l.label === "missing" && predicted === "met") score.missingCalledMet.push(l.skill);
    confusion[l.label][predicted]++;
  }
  score.unlabelledPredictions = predictions.filter((_, idx) => !used.has(idx)).map((p) => p.skill);
  return score;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function main() {
  const real = process.argv.includes("--real");
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex > 0 ? process.argv[outIndex + 1]! : here("./fit-report.md");

  const labelsFile = LabelsFile.parse(JSON.parse(readFileSync(here("./fit-labels.json"), "utf8")));
  const labelsByFile = Object.entries(labelsFile).filter((e): e is [string, z.infer<typeof Label>[]] => Array.isArray(e[1]));
  if (labelsByFile.every(([, ls]) => ls.every((l) => l.label === "TODO"))) {
    console.error("Every label in evals/fit-labels.json is still TODO. Add your own met / partial / missing judgements first.");
    process.exit(2);
  }

  const config = loadConfig({ ...process.env, NODE_ENV: "test", FAKE_AI: real ? "0" : "1", ...(real ? {} : { EMBEDDING_PROVIDER: "fake" }) });
  if (real && aiMode(config) === "fake") {
    console.error("--real needs ANTHROPIC_API_KEY. Set it in the environment or .env.");
    process.exit(2);
  }
  const deps: Deps = { store: memoryStore(), llm: await createLlm(config), embedder: createEmbedder(config), tracer: noopTracer() };
  const usages: LlmUsage[] = [];
  const track = (u: LlmUsage) => usages.push(u);
  const user = await deps.store.createUser("evals+fit@example.com", "not-a-login");
  const userId = user!.id;

  const fixtures = here("./fixtures/");
  const resume = readdirSync(fixtures).find((f) => f.startsWith("resume"))!;
  (await ingestDocument(deps, { userId, kind: "resume", filename: resume, bytes: readFileSync(fixtures + resume) })).usages.forEach(track);

  const sections: string[] = [];
  const totals = { compared: 0, correct: 0, missingCalledMet: [] as string[], todo: 0 };
  for (const [file, labels] of labelsByFile) {
    const { document, usages: ingestUsages } = await ingestDocument(deps, { userId, kind: "job", filename: file, bytes: readFileSync(fixtures + file) });
    ingestUsages.forEach(track);
    const rows = await getJobFit(deps, userId, document.id, track);
    const s = scoreFit(labels, rows.map((r) => ({ skill: r.requirement.skill, status: r.status })));
    totals.compared += s.compared;
    totals.correct += s.correct;
    totals.missingCalledMet.push(...s.missingCalledMet.map((k) => `${file}: ${k}`));
    totals.todo += s.todo;
    const statuses = FitStatus.options;
    sections.push(
      `### ${file}`,
      "",
      `${s.correct} of ${s.compared} correct.${s.todo ? ` ${s.todo} still TODO.` : ""}`,
      "",
      "| label ↓ / app → | " + statuses.join(" | ") + " |",
      "| --- | " + statuses.map(() => "---").join(" | ") + " |",
      ...statuses.map((l) => `| ${l} | ${statuses.map((p) => s.confusion[l][p]).join(" | ")} |`),
      "",
      ...(s.unmatchedLabels.length ? [`Labels with no matching requirement: ${s.unmatchedLabels.join(", ")}`, ""] : []),
      ...(s.unlabelledPredictions.length ? [`Requirements the app extracted that have no label: ${s.unlabelledPredictions.join(", ")}`, ""] : []),
    );
  }

  const accuracy = totals.compared ? totals.correct / totals.compared : NaN;
  const cost = totalCostUsd(usages);
  const mode = `${aiMode(config)} LLM (${deps.llm.modelFor("answer")}), ${embeddingMode(config)} embeddings`;
  const md = [
    "# Fit-matrix accuracy",
    "",
    `Generated by \`pnpm eval:fit${real ? " --real" : ""}\` on ${new Date().toISOString().slice(0, 10)}. **Mode:** ${mode}.`,
    "",
    `**Exact-match accuracy:** ${totals.correct} / ${totals.compared} (${(accuracy * 100).toFixed(0)}%)`,
    "",
    `**Labelled missing but called met:** ${totals.missingCalledMet.length ? totals.missingCalledMet.join(", ") : "none"}`,
    "",
    `**Estimated cost:** ${cost === null ? "n/a (fake models)" : `$${cost.toFixed(2)}`}`,
    "",
    ...sections,
  ].join("\n");
  writeFileSync(outPath, md + "\n");
  console.log(md);
  console.log(`\nReport written to ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
