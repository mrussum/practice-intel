import type { FastifyInstance } from "fastify";
import { ChatRequest, type ChatEvent } from "@career-intel/shared";
import type { Config } from "../config.js";
import type { Deps } from "../deps.js";
import { HttpError } from "../lib/errors.js";
import { answerQuestion } from "../services/chat.js";

const sse = (event: ChatEvent) => `data: ${JSON.stringify(event)}\n\n`;

export async function chatRoutes(app: FastifyInstance, { deps, config }: { deps: Deps; config: Config }) {
  app.post("/chat", { config: { rateLimit: { max: config.CHAT_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "invalid_request", "Send JSON { sessionId: uuid, message: 1-2000 characters }.");
    }

    // Stop generating (and paying for tokens) when the client goes away.
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });

    // Hijacking skips onSend hooks, so carry over headers already set (CORS).
    const inherited = Object.fromEntries(
      Object.entries(reply.getHeaders()).filter((e): e is [string, string | number | string[]] => e[1] !== undefined),
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      ...inherited,
      "x-request-id": req.id,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // One trace per question: route / retrieve / summarize / generate spans,
    // plus a generation (tokens, cost) per model call.
    const trace = deps.tracer.startTrace("chat", {
      id: req.id,
      sessionId: parsed.data.sessionId,
      input: { question: parsed.data.message },
    });
    let intent: string | undefined;
    let citations = 0;
    try {
      const events = answerQuestion(
        deps,
        { historyBudgetTokens: config.HISTORY_TOKEN_BUDGET },
        { ...parsed.data, signal: controller.signal, traceId: trace.id },
        {
          span: (name) => trace.span(name),
          onUsage: (u) => trace.generation(u),
          onContext: (ctx) =>
            trace.update({ intent: ctx.intent, targetJobIds: ctx.targetJobIds, chunkIds: ctx.refs.map((r) => r.chunkId) }),
        },
      );
      for await (const event of events) {
        if (event.type === "intent") intent = event.intent;
        if (event.type === "citations") citations = event.citations.length;
        if (controller.signal.aborted) break;
        reply.raw.write(sse(event));
      }
      const totals = trace.end({ intent, citations, aborted: controller.signal.aborted });
      req.log.info({ traceId: trace.id, intent, citations, aborted: controller.signal.aborted, ...totals }, "chat answered");
    } catch (err) {
      trace.end({ intent, error: true });
      req.log.error({ err, traceId: trace.id }, "chat failed");
      const message =
        err instanceof HttpError ? err.message : "Sorry, something went wrong while answering. Please try again.";
      if (!controller.signal.aborted) reply.raw.write(sse({ type: "error", message }));
    } finally {
      reply.raw.end();
    }
  });
}
