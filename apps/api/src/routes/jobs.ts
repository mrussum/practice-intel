import type { FastifyInstance } from "fastify";
import type { FitRow } from "@career-intel/shared";
import type { Deps } from "../deps.js";
import { getJobFit } from "../services/fit.js";
import { parseId } from "./documents.js";

export async function jobRoutes(app: FastifyInstance, { deps }: { deps: Deps }) {
  app.get("/jobs/:id/fit", async (req): Promise<FitRow[]> => getJobFit(deps, parseId(req.params)));
}
