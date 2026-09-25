import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { ApiError } from "@career-intel/shared";
import type { Config } from "./config.js";
import { createDeps, type Deps } from "./deps.js";
import { AiProviderError, HttpError, safeErrorForLog } from "./lib/errors.js";
import { LlmError } from "./lib/llm.js";
import { ParseError } from "./lib/parse.js";
import { IngestError } from "./services/ingest.js";
import { documentRoutes } from "./routes/documents.js";
import { healthRoutes } from "./routes/health.js";

function toApiError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof HttpError) return { status: err.statusCode, body: { error: err.code, message: err.message } };
  if (err instanceof ParseError) return { status: 400, body: { error: "invalid_file", message: err.message } };
  if (err instanceof IngestError) return { status: 422, body: { error: "unprocessable", message: err.message } };
  if (err instanceof AiProviderError) {
    return { status: 502, body: { error: "ai_unavailable", message: `${err.message} Try again shortly.` } };
  }
  if (err instanceof LlmError) {
    return { status: 422, body: { error: "extraction_failed", message: `${err.message} Try again, or check the document is a resume or job description.` } };
  }
  const fe = err as Partial<FastifyError>;
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    const message =
      fe.code === "FST_REQ_FILE_TOO_LARGE" ? "File is too large. The limit is 5MB." : (fe.message ?? "Bad request.");
    return { status: fe.statusCode, body: { error: fe.code ?? "bad_request", message } };
  }
  return { status: 500, body: { error: "internal", message: "Something went wrong on our side. Try again; if it persists, check the API logs." } };
}

/**
 * Builds the app without listening, so tests can use `app.inject()`
 * against the real routing/validation stack with no network.
 */
export async function buildApp(config: Config, injected?: Partial<Deps>) {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            serializers: { err: safeErrorForLog },
            // Belt and braces: never log credentials even if a header is logged.
            redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-api-key\"]"],
          },
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    },
    bodyLimit: 64 * 1024, // JSON bodies are tiny; uploads have their own multipart limit
  });

  const deps: Deps = { ...(await createDeps(config)), ...injected };
  app.addHook("onClose", () => deps.store.close());
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toApiError(err);
    if (status >= 500) req.log.error({ err }, "request failed");
    else req.log.info({ code: body.error, status }, "request rejected");
    return reply.code(status).send(body);
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "DELETE"],
    exposedHeaders: ["x-request-id"],
  });
  await app.register(multipart);
  await app.register(healthRoutes, { deps, config });
  await app.register(documentRoutes, { deps, config });

  return app;
}
