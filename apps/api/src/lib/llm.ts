/**
 * The only place that talks to a language model. Everything else calls the
 * `LLM` interface, so calls can be traced, faked in tests and moved between
 * models by config alone.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Intent, JobProfile, Requirement, ResumeProfile } from "@career-intel/shared";
import type { Config } from "../config.js";
import { aiMode } from "../config.js";
import { AiProviderError } from "./errors.js";

/** Which configured model a call uses. "fast" = cheap model for routing/extraction/judging. */
export type ModelRole = "answer" | "fast";

export interface ContextSnippet {
  ref: string;
  label: string;
  section: string;
  text: string;
}

export type ProfileContext =
  | { kind: "job"; label: string; profile: JobProfile }
  | { kind: "resume"; label: string; profile: ResumeProfile };

/**
 * Structured inputs each task's prompt is rendered from. Real models only see
 * the rendered prompt; fakes compute a deterministic answer from these fields,
 * so fakes never have to parse prompts.
 */
export interface TaskInputs {
  route: { message: string; documentLabels: string[] };
  extract_job: { text: string };
  extract_resume: { text: string };
  fit: { requirements: Requirement[]; evidence: { ref: string; text: string }[] };
  summarize: { previousSummary: string; turns: { role: "user" | "assistant"; content: string }[] };
  judge: { answer: string; context: { ref: string; text: string }[] };
  answer: {
    question: string;
    intent: Intent;
    context: ContextSnippet[];
    profiles: ProfileContext[];
  };
}
export type LlmTask = keyof TaskInputs;

export interface LlmUsage {
  task: LlmTask;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface CompleteRequest<K extends LlmTask = LlmTask> {
  task: K;
  role: ModelRole;
  system: string;
  prompt: string;
  /** When set, the model is constrained to JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  input: TaskInputs[K];
}

export interface StreamRequest {
  task: "answer";
  role: ModelRole;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  signal?: AbortSignal;
  input: TaskInputs["answer"];
}

export interface LLM {
  readonly mode: "real" | "fake";
  modelFor(role: ModelRole): string;
  complete<K extends LlmTask>(req: CompleteRequest<K>): Promise<{ text: string; usage: LlmUsage }>;
  /** Yields text deltas; the generator's return value carries usage. */
  stream(req: StreamRequest): AsyncGenerator<string, LlmUsage>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_output" | "refused",
  ) {
    super(message);
  }
}

/** Maps SDK errors to one type the API layer understands, without leaking request bodies. */
function providerError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIError) {
    return new AiProviderError(`Anthropic API error${err.status ? ` (HTTP ${err.status})` : ""}.`);
  }
  return err;
}

export function anthropicLlm(config: Config): LLM {
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  const modelFor = (role: ModelRole) => (role === "answer" ? config.ANSWER_MODEL : config.FAST_MODEL);
  // Effort is only sent for answers: Haiku 4.5 (the default fast model) rejects it.
  const effortFor = (role: ModelRole) =>
    role === "answer" && config.ANSWER_EFFORT !== "none" ? { effort: config.ANSWER_EFFORT } : {};

  return {
    mode: "real",
    modelFor,
    async complete(req) {
      const model = modelFor(req.role);
      const started = Date.now();
      const res = await client.messages
        .create({
          model,
          max_tokens: req.maxTokens ?? 4096,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          output_config: {
            ...effortFor(req.role),
            ...(req.jsonSchema ? { format: { type: "json_schema", schema: req.jsonSchema } } : {}),
          },
        })
        .catch((err: unknown) => {
          throw providerError(err);
        });
      if (res.stop_reason === "refusal") throw new LlmError("The model declined this request.", "refused");
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        text,
        usage: {
          task: req.task,
          model,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          latencyMs: Date.now() - started,
        },
      };
    },
    async *stream(req) {
      const model = modelFor(req.role);
      const started = Date.now();
      const stream = client.messages.stream(
        {
          model,
          max_tokens: req.maxTokens ?? 4096,
          system: req.system,
          messages: req.messages,
          output_config: effortFor(req.role),
        },
        { signal: req.signal },
      );
      let final: Anthropic.Message;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
        final = await stream.finalMessage();
      } catch (err) {
        throw providerError(err);
      }
      return {
        task: req.task,
        model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        latencyMs: Date.now() - started,
      };
    },
  };
}

/**
 * Structured output with validation: JSON-schema-constrained generation,
 * Zod validation, one repair attempt that shows the model its own error, then
 * a clear failure. Constrained decoding makes the retry rare, but Zod stays the
 * source of truth (enums, refinements, provider drift).
 */
export async function structured<T, K extends LlmTask>(
  llm: LLM,
  req: Omit<CompleteRequest<K>, "jsonSchema"> & { schema: z.ZodType<T> },
): Promise<{ data: T; usages: LlmUsage[] }> {
  const { schema, ...rest } = req;
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const usages: LlmUsage[] = [];

  const attempt = async (prompt: string) => {
    const { text, usage } = await llm.complete({ ...rest, prompt, jsonSchema });
    usages.push(usage);
    try {
      return schema.safeParse(JSON.parse(text));
    } catch {
      return { success: false as const, error: new Error("Response was not valid JSON.") };
    }
  };

  const first = await attempt(req.prompt);
  if (first.success) return { data: first.data, usages };

  const problem = first.error instanceof z.ZodError ? z.prettifyError(first.error) : first.error.message;
  const second = await attempt(
    `${req.prompt}\n\nYour previous answer did not match the required schema:\n${problem}\nReturn corrected JSON only.`,
  );
  if (second.success) return { data: second.data, usages };

  throw new LlmError(`The ${req.task} step returned invalid structured output twice.`, "invalid_output");
}

export async function createLlm(config: Config): Promise<LLM> {
  if (aiMode(config) === "real") return anthropicLlm(config);
  const { fakeLlm } = await import("./fake-llm.js");
  return fakeLlm();
}
