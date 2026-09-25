/**
 * Deterministic stand-in for the real models (FAKE_AI=1, tests, CI evals).
 *
 * Each task is a small heuristic over the structured inputs, not over the
 * rendered prompt. The fakes are crude on purpose. They exist so the whole
 * pipeline (routing, retrieval, citations, persistence, streaming) can be
 * exercised offline and reproducibly. They are not a claim about answer
 * quality: the real-model eval mode measures that.
 */
import type { FitStatus, Intent, JobProfile, Requirement, ResumeProfile } from "@career-intel/shared";
import { chunkByStructure } from "./chunking.js";
import type { CompleteRequest, ContextSnippet, LLM, LlmTask, LlmUsage, TaskInputs } from "./llm.js";
import { estimateTokens, tokenize, truncate } from "./text.js";

export const NOT_FOUND = "not found in your documents";

// ---- routing -----------------------------------------------------------------

const CAREER_TERMS =
  /\b(job|jobs|role|roles|resume|cv|skill|skills|experience|fit|gap|gaps|missing|interview|compare|position|qualif\w*|requirement\w*|match|career|apply|application|strength\w*|weakness\w*|candidate|background|work|worked|working|projects?|education|degree|certif\w*|technolog\w*|tools?|stack|prepare|hiring|salary|responsibilit\w*|company|companies|employer)\b|job\s*#?\d/i;

export function fakeRoute(message: string): Intent {
  const m = message.toLowerCase();
  if (!CAREER_TERMS.test(m)) return "off_topic";
  if (/\bcompare|\bwhich (job|role|position)|\brank|\bbest fit|\bbetter fit|\bversus\b|\bvs\.?\s/.test(m)) return "compare";
  if (/\binterview|\bprepare for|\bquestions? (might|will|could|would)|\bstar stor/.test(m)) return "interview_prep";
  if (/\bmissing|\bgaps?\b|\black|\bimprove|\blearn|\bweak|\bdon't have|\bneed to/.test(m)) return "gaps";
  if (/\bfit\b|\bmatch|\balign|\bqualified|\bsuited|\bstrength|\bgood candidate|\bhow well/.test(m)) return "fit";
  return "general";
}

// ---- extraction --------------------------------------------------------------

const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/** "5+ years of experience with Kubernetes in production" → "Kubernetes". */
export function skillOf(line: string): string {
  let s = line.replace(BULLET, "").trim();
  const colon = s.indexOf(":");
  if (colon > 0 && colon < 50) return s.slice(0, colon).trim();
  s = s
    .replace(/^\d+\+?\s*years?\s*(of\s+)?(professional\s+|commercial\s+)?(experience\s+)?(with|in|using|of)?\s*/i, "")
    .replace(/^(strong|solid|proven|deep|hands-on|excellent|good)\s+/i, "")
    .replace(/^(experience|knowledge|familiarity|proficiency|expertise|understanding)\s+(with|of|in)\s+/i, "");
  const cut = s.split(/,|\(|;|\.\s|\s(?:and|or|to|for)\s/)[0] ?? s;
  return cut.split(/\s+/).slice(0, 5).join(" ").replace(/\.$/, "").trim();
}

function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2);
}

export function fakeExtractJob(text: string): JobProfile {
  const lines = bulletLines(text);
  const title = (lines[0] ?? "Untitled role").replace(/^#+\s*/, "").replace(/^(job\s+)?title:\s*/i, "");
  const company = text.match(/^\s*company:\s*(.+)$/im)?.[1]?.trim();
  const requirements: Requirement[] = [];
  for (const chunk of chunkByStructure(text)) {
    if (chunk.section !== "requirements" && chunk.section !== "nice_to_have") continue;
    for (const line of bulletLines(chunk.text)) {
      requirements.push({
        text: line.replace(BULLET, ""),
        skill: skillOf(line),
        priority: chunk.section === "requirements" ? "must" : "nice",
      });
    }
  }
  return { title, ...(company ? { company } : {}), requirements };
}

export function fakeExtractResume(text: string): ResumeProfile {
  const lines = bulletLines(text);
  const chunks = chunkByStructure(text);
  const prose = chunks.filter((c) => c.section !== "skills").map((c) => c.text);
  const skills: ResumeProfile["skills"] = [];
  const seen = new Set<string>();
  for (const chunk of chunks.filter((c) => c.section === "skills")) {
    for (const line of bulletLines(chunk.text)) {
      const list = line.replace(BULLET, "").replace(/^[^:]{1,30}:\s*/, "");
      for (const raw of list.split(/[,;|]/)) {
        const skill = raw.trim().replace(/\.$/, "");
        if (!skill || seen.has(skill.toLowerCase())) continue;
        seen.add(skill.toLowerCase());
        const evidence =
          prose
            .flatMap((p) => p.split(/(?<=[.!?])\s+|\n/))
            .find((sentence) => sentence.toLowerCase().includes(skill.toLowerCase())) ?? line;
        skills.push({ skill, evidence: evidence.replace(BULLET, "").trim() });
      }
    }
  }
  return {
    ...(lines[0] ? { name: lines[0].replace(/^#+\s*/, "") } : {}),
    ...(lines[1] && lines[1].length < 100 ? { headline: lines[1] } : {}),
    skills,
  };
}

// ---- fit ---------------------------------------------------------------------

function coverage(skill: string, text: string): number {
  const need = tokenize(skill);
  if (need.length === 0) return 0;
  const have = new Set(tokenize(text));
  return need.filter((t) => have.has(t)).length / need.length;
}

export function fakeFit(input: TaskInputs["fit"]) {
  return {
    rows: input.requirements.map((req, requirementIndex) => {
      const scored = input.evidence
        .map((e) => ({ ref: e.ref, score: coverage(req.skill, e.text) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.score ?? 0;
      const status: FitStatus = best === 1 ? "met" : best > 0 ? "partial" : "missing";
      const refs = scored.filter((e) => e.score === best).slice(0, 3).map((e) => e.ref);
      const rationale =
        status === "met"
          ? `The resume mentions ${req.skill} directly.`
          : status === "partial"
            ? `The resume mentions part of "${req.skill}" but not all of it.`
            : `No mention of ${req.skill} in the resume.`;
      return { requirementIndex, status, rationale, evidenceRefs: status === "missing" ? [] : refs };
    }),
  };
}

// ---- answers -----------------------------------------------------------------

// Words that appear in almost every question and would make every chunk "relevant".
const GENERIC = new Set(["job", "jobs", "role", "roles", "experience", "skills", "skill", "resume", "used", "work", "worked", "use", "using", "any"]);

function relevance(question: string, text: string): number {
  const have = new Set(tokenize(text));
  return tokenize(question).filter((t) => !GENERIC.has(t) && have.has(t)).length;
}

function refFor(context: ContextSnippet[], label: string, phrase: string): string | undefined {
  return context
    .filter((c) => c.label === label)
    .map((c) => ({ c, score: coverage(phrase, c.text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.c.ref;
}

const cite = (ref: string | undefined) => (ref ? ` [${ref}]` : "");

export function fakeAnswer(input: TaskInputs["answer"]): string {
  const { context, profiles, intent, question } = input;
  if (context.length === 0 && profiles.length === 0) {
    return `That information was ${NOT_FOUND}. Upload a resume and at least one job description, then ask again.`;
  }

  const resume = profiles.find((p) => p.kind === "resume");
  const resumeText = [
    ...context.filter((c) => c.label === resume?.label).map((c) => c.text),
    ...(resume?.kind === "resume" ? resume.profile.skills.map((s) => `${s.skill} ${s.evidence}`) : []),
  ].join("\n");
  const jobs = profiles.filter((p): p is Extract<typeof p, { kind: "job" }> => p.kind === "job");

  if ((intent === "gaps" || intent === "fit" || intent === "compare") && jobs.length > 0 && resume) {
    const lines: string[] = [];
    const ranked = jobs
      .map((job) => {
        const reqs = job.profile.requirements;
        const met = reqs.filter((r) => coverage(r.skill, resumeText) === 1);
        const missing = reqs.filter((r) => coverage(r.skill, resumeText) < 1);
        return { job, reqs, met, missing };
      })
      .sort((a, b) => b.met.length / Math.max(b.reqs.length, 1) - a.met.length / Math.max(a.reqs.length, 1));

    for (const { job, reqs, met, missing } of ranked) {
      const name = `${job.label} (${job.profile.title})`;
      if (intent === "gaps") {
        if (missing.length === 0) lines.push(`- ${name}: no gaps found against the listed requirements.`);
        for (const r of missing) {
          lines.push(`- ${name}: missing ${r.skill} (${r.priority === "must" ? "must-have" : "nice-to-have"})${cite(refFor(context, job.label, r.skill))}`);
        }
      } else {
        const evidence = met
          .slice(0, 3)
          .map((r) => `${r.skill}${cite(refFor(context, resume.label, r.skill))}`)
          .join(", ");
        lines.push(`- ${name}: ${met.length} of ${reqs.length} requirements have evidence in your resume${evidence ? `, including ${evidence}` : ""}.`);
      }
    }
    const heading = intent === "gaps" ? "Gaps between your resume and the job requirements:" : intent === "compare" ? "Jobs ranked by how many requirements your resume covers:" : "How your resume lines up:";
    return `${heading}\n${lines.join("\n")}`;
  }

  const scored = context
    .map((c, i) => ({ c, i, score: relevance(question, `${c.section} ${c.text}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3);
  if (scored.length === 0) return `I checked your documents and that was ${NOT_FOUND}.`;

  const intro = intent === "interview_prep" ? "Areas to prepare, based on your documents:" : "Here is what your documents say:";
  return `${intro}\n${scored.map(({ c }) => `- ${c.label} (${c.section}): ${truncate(c.text, 160)} [${c.ref}]`).join("\n")}`;
}

// ---- the fake LLM ------------------------------------------------------------

function respond<K extends LlmTask>(req: CompleteRequest<K>): string {
  const input = req.input as TaskInputs[LlmTask];
  switch (req.task) {
    case "route": {
      const { message } = input as TaskInputs["route"];
      return JSON.stringify({ intent: fakeRoute(message) });
    }
    case "extract_job":
      return JSON.stringify(fakeExtractJob((input as TaskInputs["extract_job"]).text));
    case "extract_resume":
      return JSON.stringify(fakeExtractResume((input as TaskInputs["extract_resume"]).text));
    case "fit":
      return JSON.stringify(fakeFit(input as TaskInputs["fit"]));
    case "summarize": {
      const { previousSummary, turns } = input as TaskInputs["summarize"];
      const lines = turns.map((t) => `${t.role === "user" ? "User asked" : "Assistant said"}: ${truncate(t.content, 100)}`);
      return truncate([previousSummary, ...lines].filter(Boolean).join("\n"), 1200);
    }
    case "judge": {
      const { answer } = input as TaskInputs["judge"];
      const sentences = answer.split(/\n|(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
      const cited = sentences.filter((s) => /\[C\d+\]/.test(s)).length;
      return JSON.stringify({ score: sentences.length ? cited / sentences.length : 1, unsupportedClaims: [] });
    }
    case "answer":
      return fakeAnswer(input as TaskInputs["answer"]);
  }
  throw new Error(`Fake LLM has no handler for task "${String(req.task)}".`);
}

export function fakeLlm(): LLM {
  const usage = (task: LlmTask, prompt: string, output: string): LlmUsage => ({
    task,
    model: "fake",
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(output),
    latencyMs: 0,
  });
  return {
    mode: "fake",
    modelFor: () => "fake",
    async complete(req) {
      const text = respond(req);
      return { text, usage: usage(req.task, req.system + req.prompt, text) };
    },
    async *stream(req) {
      const text = fakeAnswer(req.input);
      // Word-sized deltas so the client-side streaming path is exercised.
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        if (req.signal?.aborted) break;
        yield piece;
      }
      return usage(req.task, req.system + req.messages.map((m) => m.content).join(""), text);
    },
  };
}
