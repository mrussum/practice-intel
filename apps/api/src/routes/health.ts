import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  // Liveness only for now. Day 2: add /ready that checks the DB connection.
  app.get("/health", async () => ({ status: "ok" }));
}
