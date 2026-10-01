/**
 * Two users on one server: nothing of Alice's may be visible to, or
 * changeable by, Bob, whichever route or id he tries.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentSummary } from "@career-intel/shared";
import { buildApp } from "../src/app.js";
import { ask, SAMPLE_JOB, SAMPLE_RESUME, signUp, testConfig, testDeps, upload } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function twoUsers() {
  const server = await buildApp(testConfig(), testDeps());
  close = () => server.close();
  const alice = await signUp(server, "alice@example.com");
  const bob = await signUp(server, "bob@example.com");
  const resume = (await upload(alice, "resume", "alice-cv.txt", SAMPLE_RESUME)).json() as DocumentSummary;
  const job = (await upload(alice, "job", "alice-job.md", SAMPLE_JOB)).json() as DocumentSummary;
  return { alice, bob, resume, job };
}

describe("per-user isolation", () => {
  it("Bob's document list doesn't include Alice's documents", async () => {
    const { bob, alice } = await twoUsers();
    expect((await bob.inject({ method: "GET", url: "/documents" })).json()).toEqual([]);
    expect(((await alice.inject({ method: "GET", url: "/documents" })).json() as unknown[]).length).toBe(2);
  });

  it("Alice's ids 404 for Bob on read, delete and fit, and her data survives", async () => {
    const { bob, alice, resume, job } = await twoUsers();
    expect((await bob.inject({ method: "GET", url: `/documents/${resume.id}` })).statusCode).toBe(404);
    expect((await bob.inject({ method: "DELETE", url: `/documents/${job.id}` })).statusCode).toBe(404);
    expect((await bob.inject({ method: "GET", url: `/jobs/${job.id}/fit` })).statusCode).toBe(404);
    expect((await alice.inject({ method: "GET", url: `/documents/${job.id}` })).statusCode).toBe(200);
  });

  it("labels and the one-resume rule are per user", async () => {
    const { bob, alice } = await twoUsers();
    const bobJob = (await upload(bob, "job", "bob-job.md", SAMPLE_JOB)).json() as DocumentSummary;
    expect(bobJob.label).toBe("Job #1");
    await upload(bob, "resume", "bob-cv.txt", SAMPLE_RESUME);
    const aliceDocs = (await alice.inject({ method: "GET", url: "/documents" })).json() as DocumentSummary[];
    expect(aliceDocs.find((d) => d.kind === "resume")?.filename).toBe("alice-cv.txt");
  });

  it("Bob's chat can't retrieve or cite Alice's documents", async () => {
    const { bob, resume, job } = await twoUsers();
    const { events, answer } = await ask(bob, "What skills am I missing for Job #1? I know PostgreSQL and Kubernetes.");
    const citations = events.find((e) => e.type === "citations");
    expect(citations).toMatchObject({ citations: [] });
    expect(answer).toContain("not found in your documents");
    expect(JSON.stringify(events)).not.toContain(resume.id);
    expect(JSON.stringify(events)).not.toContain(job.id);
  });

  it("Bob can't continue Alice's chat session", async () => {
    const { alice, bob } = await twoUsers();
    const { sessionId } = await ask(alice, "Where did I work before?");
    const res = await bob.inject({ method: "POST", url: "/chat", payload: { sessionId, message: "What did we discuss?" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("session_not_found");
  });
});
