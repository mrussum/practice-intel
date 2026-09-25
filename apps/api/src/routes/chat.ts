import type { FastifyInstance } from "fastify";
import { ChatRequest, type ChatEvent } from "@career-intel/shared";
import type { Config } from "../config.js";
import type { Deps } from "../deps.js";
import { HttpError } from "../lib/errors.js";
import { answerQuestion } from "../services/chat.js";

const sse = (event: ChatEvent) => `data: ${JSON.stringify(event)}\n\n`;

export async function chatRoutes(app: FastifyInstance, { deps, config }: { deps: Deps; config: Config }) {
  app.post("/chat", async (req, reply) => {
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

    const started = Date.now();
    let intent: string | undefined;
    try {
      const events = answerQuestion(
        deps,
        { historyBudgetTokens: config.HISTORY_TOKEN_BUDGET },
        { ...parsed.data, signal: controller.signal, traceId: req.id },
      );
      for await (const event of events) {
        if (event.type === "intent") intent = event.intent;
        if (controller.signal.aborted) break;
        reply.raw.write(sse(event));
      }
      req.log.info({ intent, ms: Date.now() - started, aborted: controller.signal.aborted }, "chat answered");
    } catch (err) {
      req.log.error({ err }, "chat failed");
      const message =
        err instanceof HttpError ? err.message : "Sorry, something went wrong while answering. Please try again.";
      if (!controller.signal.aborted) reply.raw.write(sse({ type: "error", message }));
    } finally {
      reply.raw.end();
    }
  });
}
