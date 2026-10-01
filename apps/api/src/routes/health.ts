import type { FastifyInstance } from "fastify";
import type { ReadyResponse } from "@career-intel/shared";
import type { Config } from "../config.js";
import { aiMode, embeddingMode } from "../config.js";
import type { Deps } from "../deps.js";

export async function healthRoutes(app: FastifyInstance, { deps, config }: { deps: Deps; config: Config }) {
  // Liveness: the process is up. Never touches dependencies.
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Readiness: can we serve traffic? Checks the store and reports AI mode.
  app.get("/ready", { config: { rateLimit: false } }, async (req, reply) => {
    const body: ReadyResponse = {
      status: "ready",
      store: deps.store.kind,
      ai: aiMode(config),
      embeddings: embeddingMode(config),
    };
    try {
      await deps.store.ping();
    } catch (err) {
      req.log.warn({ err }, "readiness check failed: store unreachable");
      return reply.code(503).send({ ...body, status: "unavailable" });
    }
    return body;
  });
}
