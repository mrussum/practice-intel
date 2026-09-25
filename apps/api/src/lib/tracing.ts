/**
 * Tracing behind a small interface: Langfuse when keys are configured,
 * otherwise a no-op that still hands out trace ids (they correlate with logs).
 *
 * What is sent: step timings, model names, token usage, estimated cost,
 * intent, retrieved chunk ids, and the user's question. Document text is not
 * sent, to keep the same boundary as the logs.
 */
import { randomUUID } from "node:crypto";
import { Langfuse } from "langfuse";
import type { Config } from "../config.js";
import type { LlmUsage } from "./llm.js";
import { estimateCostUsd } from "./pricing.js";

export interface Span {
  end(output?: Record<string, unknown>): void;
}

export interface Trace {
  readonly id: string;
  span(name: string): Span;
  generation(usage: LlmUsage): void;
  /** Adds metadata/output and closes the trace. Returns the totals. */
  end(output?: Record<string, unknown>): TraceTotals;
  update(metadata: Record<string, unknown>): void;
}

export interface TraceTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface Tracer {
  readonly enabled: boolean;
  startTrace(name: string, opts: { id?: string; sessionId?: string; input?: Record<string, unknown> }): Trace;
  shutdown(): Promise<void>;
}

/** Totals are tracked locally either way, so logs get cost/latency even without Langfuse. */
function totalsTracker() {
  const started = Date.now();
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    add(u: LlmUsage) {
      totals.inputTokens += u.inputTokens;
      totals.outputTokens += u.outputTokens;
      totals.costUsd += estimateCostUsd(u.model, u.inputTokens, u.outputTokens) ?? 0;
    },
    done: (): TraceTotals => ({ ...totals, costUsd: Number(totals.costUsd.toFixed(6)), latencyMs: Date.now() - started }),
  };
}

export function noopTracer(): Tracer {
  return {
    enabled: false,
    startTrace(_name, opts) {
      const totals = totalsTracker();
      return {
        id: opts.id ?? randomUUID(),
        span: () => ({ end() {} }),
        generation: (u) => totals.add(u),
        update() {},
        end: () => totals.done(),
      };
    },
    async shutdown() {},
  };
}

export function langfuseTracer(config: { publicKey: string; secretKey: string; baseUrl?: string }): Tracer {
  const client = new Langfuse({ publicKey: config.publicKey, secretKey: config.secretKey, baseUrl: config.baseUrl });
  return {
    enabled: true,
    startTrace(name, opts) {
      const totals = totalsTracker();
      const trace = client.trace({ id: opts.id, name, sessionId: opts.sessionId, input: opts.input });
      return {
        id: trace.id,
        span(spanName) {
          const span = trace.span({ name: spanName, startTime: new Date() });
          return { end: (output) => void span.end({ output }) };
        },
        generation(u) {
          totals.add(u);
          const endTime = new Date();
          const cost = estimateCostUsd(u.model, u.inputTokens, u.outputTokens);
          trace.generation({
            name: u.task,
            model: u.model,
            startTime: new Date(endTime.getTime() - u.latencyMs),
            endTime,
            usageDetails: { input: u.inputTokens, output: u.outputTokens },
            ...(cost !== undefined ? { costDetails: { total: cost } } : {}),
          });
        },
        update(metadata) {
          trace.update({ metadata });
        },
        end(output) {
          const t = totals.done();
          trace.update({ output: { ...output, ...t } });
          return t;
        },
      };
    },
    shutdown: () => client.shutdownAsync(),
  };
}

export function createTracer(config: Config): Tracer {
  if (config.LANGFUSE_PUBLIC_KEY && config.LANGFUSE_SECRET_KEY) {
    return langfuseTracer({
      publicKey: config.LANGFUSE_PUBLIC_KEY,
      secretKey: config.LANGFUSE_SECRET_KEY,
      baseUrl: config.LANGFUSE_HOST,
    });
  }
  return noopTracer();
}
