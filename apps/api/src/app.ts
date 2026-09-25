import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

/**
 * Builds the app without listening, so tests can use `app.inject()`
 * against the real routing/validation stack with no network.
 */
export async function buildApp(config: Config) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    genReqId: () => crypto.randomUUID(), // request id on every log line
  });

  await app.register(cors, { origin: config.WEB_ORIGIN });
  await app.register(healthRoutes);
  // TODO day 2: documentsRoutes (upload + ingest)
  // TODO day 3: chatRoutes (SSE)

  return app;
}
