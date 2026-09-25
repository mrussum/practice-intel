import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DocumentKind, type DocumentDetail, type DocumentSummary } from "@career-intel/shared";
import type { Config } from "../config.js";
import type { Deps } from "../deps.js";
import { HttpError } from "../lib/errors.js";
import { ingestDocument } from "../services/ingest.js";
import type { StoredDocument } from "../store/types.js";

const IdParams = z.object({ id: z.string().uuid() });
const UploadQuery = z.object({ kind: DocumentKind });

export function toSummary(d: StoredDocument): DocumentSummary {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    label: d.label,
    filename: d.filename,
    chunkCount: d.chunkCount,
    createdAt: d.createdAt.toISOString(),
  };
}

export function parseId(params: unknown): string {
  const parsed = IdParams.safeParse(params);
  if (!parsed.success) throw new HttpError(400, "invalid_id", "Document id must be a UUID.");
  return parsed.data.id;
}

export async function documentRoutes(app: FastifyInstance, { deps, config }: { deps: Deps; config: Config }) {
  app.post("/documents", async (req, reply) => {
    const query = UploadQuery.safeParse(req.query);
    if (!query.success) throw new HttpError(400, "invalid_kind", 'Add ?kind=resume or ?kind=job to the upload URL.');
    if (!req.isMultipart()) throw new HttpError(400, "not_multipart", "Send the file as multipart/form-data in a field named \"file\".");

    const file = await req.file({ limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "missing_file", "No file received. Attach one PDF, DOCX, TXT or MD file.");
    const bytes = await file.toBuffer(); // throws 413 past the size limit

    const { document, usages } = await ingestDocument(deps, { kind: query.data.kind, filename: file.filename, bytes });
    // Sizes and counts only: document text never goes to the logs.
    req.log.info(
      { documentId: document.id, kind: document.kind, bytes: bytes.length, chunks: document.chunkCount, llmCalls: usages.length },
      "document ingested",
    );
    return reply.code(201).send(toSummary(document));
  });

  app.get("/documents", async () => (await deps.store.listDocuments()).map(toSummary));

  app.get("/documents/:id", async (req): Promise<DocumentDetail> => {
    const id = parseId(req.params);
    const doc = await deps.store.getDocument(id);
    if (!doc) throw new HttpError(404, "not_found", "Document not found. It may have been deleted.");
    return { ...toSummary(doc), profile: doc.profile, chunks: await deps.store.getChunks(id) };
  });

  app.delete("/documents/:id", async (req, reply) => {
    const id = parseId(req.params);
    if (!(await deps.store.deleteDocument(id))) {
      throw new HttpError(404, "not_found", "Document not found. It may already have been deleted.");
    }
    req.log.info({ documentId: id }, "document deleted");
    return reply.code(204).send();
  });
}
