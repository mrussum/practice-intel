/**
 * Runs the real Postgres store (pgvector + tsvector + migrations) against a
 * throwaway container. Skipped automatically when Docker is unavailable, or
 * with SKIP_DOCKER_TESTS=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, getContainerRuntimeClient, Wait, type StartedTestContainer } from "testcontainers";
import type { FitRow } from "@career-intel/shared";
import { runMigrations } from "../src/db/migrate.js";
import { fakeEmbedder } from "../src/lib/embeddings.js";
import { fakeLlm } from "../src/lib/fake-llm.js";
import { ingestDocument } from "../src/services/ingest.js";
import { postgresStore } from "../src/store/postgres.js";
import type { Store } from "../src/store/types.js";
import { SAMPLE_JOB, SAMPLE_RESUME } from "./helpers.js";

async function dockerAvailable(): Promise<boolean> {
  if (process.env.SKIP_DOCKER_TESTS === "1") return false;
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

const enabled = await dockerAvailable();

describe.skipIf(!enabled)("postgresStore (integration)", () => {
  let container: StartedTestContainer;
  let store: Store;
  const embedder = fakeEmbedder();
  const deps = () => ({ store, llm: fakeLlm(), embedder });
  const file = (text: string, name: string) => ({ filename: name, bytes: Buffer.from(text) });

  beforeAll(async () => {
    container = await new GenericContainer("pgvector/pgvector:pg16")
      .withEnvironment({ POSTGRES_USER: "t", POSTGRES_PASSWORD: "t", POSTGRES_DB: "t" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://t:t@${container.getHost()}:${container.getMappedPort(5432)}/t`;
    await runMigrations(url);
    await runMigrations(url); // idempotent
    store = postgresStore(url);
  }, 120_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  });

  it("ingests, labels and lists documents with chunk counts", async () => {
    await ingestDocument(deps(), { kind: "resume", ...file(SAMPLE_RESUME, "cv.txt") });
    const job = await ingestDocument(deps(), { kind: "job", ...file(SAMPLE_JOB, "a.md") });
    await ingestDocument(deps(), { kind: "job", ...file(SAMPLE_JOB.replace("Kubernetes", "Rust"), "b.md") });

    const docs = await store.listDocuments();
    expect(docs.map((d) => d.label)).toEqual(["Resume", "Job #1", "Job #2"]);
    expect(job.document.chunkCount).toBeGreaterThan(1);
    expect((await store.getChunks(job.document.id)).map((c) => c.section)).toEqual(["header", "requirements", "nice_to_have"]);
  });

  it("vector and full-text search rank the relevant chunk first and honour document filters", async () => {
    const [, job1, job2] = await store.listDocuments();
    const [q] = await embedder.embed(["Kubernetes clusters"], "query");

    const byVector = await store.vectorSearch(q!, { limit: 3 });
    expect(byVector[0]!.text).toContain("Kubernetes");

    const byText = await store.textSearch("who knows kubernetes?", { limit: 5 });
    expect(byText.length).toBeGreaterThan(0);
    expect(byText.every((c) => c.text.toLowerCase().includes("kubernetes"))).toBe(true);

    const scoped = await store.textSearch("kubernetes rust", { limit: 5, documentIds: [job2!.id] });
    expect(scoped.every((c) => c.documentId === job2!.id)).toBe(true);
    expect(await store.vectorSearch(q!, { limit: 5, documentIds: [] })).toEqual([]);
    expect(job1).toBeDefined();
  });

  it("caches fit rows until any document changes", async () => {
    const [, job1] = await store.listDocuments();
    const rows: FitRow[] = [
      { requirement: { text: "TS", skill: "TypeScript", priority: "must" }, status: "met", rationale: "r", evidenceChunkIds: [] },
    ];
    await store.putFit(job1!.id, rows);
    expect(await store.getFit(job1!.id)).toEqual(rows);

    await ingestDocument(deps(), { kind: "resume", ...file(SAMPLE_RESUME, "cv2.txt") });
    expect(await store.getFit(job1!.id)).toBeNull();
    expect((await store.listDocuments()).filter((d) => d.kind === "resume").map((d) => d.filename)).toEqual(["cv2.txt"]);
  });

  it("deletes documents with their chunks, and ignores fit writes for deleted jobs", async () => {
    const [, , job2] = await store.listDocuments();
    expect(await store.deleteDocument(job2!.id)).toBe(true);
    expect(await store.getChunks(job2!.id)).toEqual([]);
    await expect(store.putFit(job2!.id, [])).resolves.toBeUndefined();
    expect(await store.deleteDocument(job2!.id)).toBe(false);
  });

  it("persists sessions, messages and summaries", async () => {
    const id = crypto.randomUUID();
    expect(await store.getOrCreateSession(id)).toEqual({ id, summary: "", summarizedCount: 0 });
    await store.appendMessage(id, { role: "user", content: "hi", intent: "general", citations: [] });
    await store.appendMessage(id, { role: "assistant", content: "hello", intent: "general", citations: [] });
    await store.updateSummary(id, "greeted", 2);
    expect((await store.listMessages(id)).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await store.getOrCreateSession(id)).toMatchObject({ summary: "greeted", summarizedCount: 2 });
  });
});
