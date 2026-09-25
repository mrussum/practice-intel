import type { FastifyInstance } from "fastify";
import type { FitRow } from "@career-intel/shared";
import type { Deps } from "../deps.js";
import { getJobFit } from "../services/fit.js";
import { parseId } from "./documents.js";

export async function jobRoutes(app: FastifyInstance, { deps }: { deps: Deps }) {
  app.get("/jobs/:id/fit", async (req): Promise<FitRow[]> => {
    const id = parseId(req.params);
    const trace = deps.tracer.startTrace("fit", { id: req.id, input: { jobId: id } });
    const rows = await getJobFit(deps, id, (u) => trace.generation(u));
    const totals = trace.end({ rows: rows.length });
    if (totals.outputTokens) req.log.info({ jobId: id, rows: rows.length, ...totals }, "fit computed");
    return rows;
  });
}
