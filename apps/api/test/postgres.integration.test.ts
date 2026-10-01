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
  let alice: string;
  let bob: string;
  const embedder = fakeEmbedder();
  const deps = () => ({ store, llm: fakeLlm(), embedder });
  const file = (userId: string, text: string, name: string) => ({ userId, filename: name, bytes: Buffer.from(text) });

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
    alice = (await store.createUser("alice@example.com", "hash-a"))!.id;
    bob = (await store.createUser("bob@example.com", "hash-b"))!.id;
  }, 120_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  });

  it("creates users with unique emails and finds them", async () => {
    expect(await store.createUser("alice@example.com", "other")).toBeNull();
    expect(await store.findUserByEmail("alice@example.com")).toMatchObject({ id: alice, passwordHash: "hash-a" });
    expect(await store.findUserByEmail("nobody@example.com")).toBeNull();
  });

  it("stores hashed login sessions and ignores expired ones", async () => {
    await store.createAuthSession("live", alice, new Date(Date.now() + 60_000));
    await store.createAuthSession("dead", alice, new Date(Date.now() - 1_000));
    expect(await store.findAuthSession("live")).toMatchObject({ userId: alice, email: "alice@example.com" });
    expect(await store.findAuthSession("dead")).toBeNull();
    await store.deleteExpiredAuthSessions(alice);
    await store.deleteAuthSession("live");
    expect(await store.findAuthSession("live")).toBeNull();
  });

  it("ingests, labels and lists documents per user", async () => {
    await ingestDocument(deps(), { kind: "resume", ...file(alice, SAMPLE_RESUME, "cv.txt") });
    const job = await ingestDocument(deps(), { kind: "job", ...file(alice, SAMPLE_JOB, "a.md") });
    await ingestDocument(deps(), { kind: "job", ...file(alice, SAMPLE_JOB.replace("Kubernetes", "Rust"), "b.md") });
    await ingestDocument(deps(), { kind: "job", ...file(bob, SAMPLE_JOB, "bob.md") });

    expect((await store.listDocuments(alice)).map((d) => d.label)).toEqual(["Resume", "Job #1", "Job #2"]);
    // Labels are numbered per user.
    expect((await store.listDocuments(bob)).map((d) => d.label)).toEqual(["Job #1"]);
    expect(job.document.chunkCount).toBeGreaterThan(1);
    expect((await store.getChunks(alice, job.document.id)).map((c) => c.section)).toEqual(["header", "requirements", "nice_to_have"]);
  });

  it("never returns another user's documents or chunks", async () => {
    const [aliceResume] = await store.listDocuments(alice);
    expect(await store.getDocument(bob, aliceResume!.id)).toBeNull();
    expect(await store.getChunks(bob, aliceResume!.id)).toEqual([]);
    expect(await store.deleteDocument(bob, aliceResume!.id)).toBe(false);
    expect(await store.getDocument(alice, aliceResume!.id)).not.toBeNull();
  });

  it("vector and full-text search rank the relevant chunk first and honour document filters", async () => {
    const docs = await store.listDocuments(alice);
    const ids = docs.map((d) => d.id);
    const job2 = docs[2]!;
    const [q] = await embedder.embed(["Kubernetes clusters"], "query");

    const byVector = await store.vectorSearch(q!, { limit: 3, documentIds: ids });
    expect(byVector[0]!.text).toContain("Kubernetes");

    const byText = await store.textSearch("who knows kubernetes?", { limit: 5, documentIds: ids });
    expect(byText.length).toBeGreaterThan(0);
    expect(byText.every((c) => c.text.toLowerCase().includes("kubernetes"))).toBe(true);
    expect(byText.every((c) => ids.includes(c.documentId))).toBe(true);

    const scoped = await store.textSearch("kubernetes rust", { limit: 5, documentIds: [job2.id] });
    expect(scoped.every((c) => c.documentId === job2.id)).toBe(true);
    expect(await store.vectorSearch(q!, { limit: 5, documentIds: [] })).toEqual([]);
  });

  it("caches fit rows until that user's documents change, leaving other users' caches alone", async () => {
    const [, aliceJob1] = await store.listDocuments(alice);
    const [bobJob] = await store.listDocuments(bob);
    const rows: FitRow[] = [
      { requirement: { text: "TS", skill: "TypeScript", priority: "must" }, status: "met", rationale: "r", evidenceChunkIds: [] },
    ];
    await store.putFit(aliceJob1!.id, rows);
    await store.putFit(bobJob!.id, rows);
    expect(await store.getFit(aliceJob1!.id)).toEqual(rows);

    await ingestDocument(deps(), { kind: "resume", ...file(alice, SAMPLE_RESUME, "cv2.txt") });
    expect(await store.getFit(aliceJob1!.id)).toBeNull();
    expect(await store.getFit(bobJob!.id)).toEqual(rows);
    expect((await store.listDocuments(alice)).filter((d) => d.kind === "resume").map((d) => d.filename)).toEqual(["cv2.txt"]);
  });

  it("deletes documents with their chunks, and ignores fit writes for deleted jobs", async () => {
    const [, , job2] = await store.listDocuments(alice);
    expect(await store.deleteDocument(alice, job2!.id)).toBe(true);
    expect(await store.getChunks(alice, job2!.id)).toEqual([]);
    await expect(store.putFit(job2!.id, [])).resolves.toBeUndefined();
    expect(await store.deleteDocument(alice, job2!.id)).toBe(false);
  });

  it("persists chat sessions per user and refuses another user's session id", async () => {
    const id = crypto.randomUUID();
    expect(await store.getOrCreateSession(alice, id)).toEqual({ id, summary: "", summarizedCount: 0 });
    expect(await store.getOrCreateSession(bob, id)).toBeNull();
    await store.appendMessage(id, { role: "user", content: "hi", intent: "general", citations: [] });
    await store.appendMessage(id, { role: "assistant", content: "hello", intent: "general", citations: [] });
    await store.updateSummary(id, "greeted", 2);
    expect((await store.listMessages(id)).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await store.getOrCreateSession(alice, id)).toMatchObject({ summary: "greeted", summarizedCount: 2 });
  });
});
