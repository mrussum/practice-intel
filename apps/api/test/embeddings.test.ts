import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIM } from "../src/db/schema.js";
import { fakeEmbedder, voyageEmbedder } from "../src/lib/embeddings.js";
import { AiProviderError } from "../src/lib/errors.js";

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe("fakeEmbedder", () => {
  it("is deterministic, unit-length and the right size", async () => {
    const e = fakeEmbedder();
    const [a, b] = await e.embed(["Kubernetes clusters", "Kubernetes clusters"], "document");
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(b);
    expect(cos(a!, a!)).toBeCloseTo(1, 6);
  });

  it("places texts with shared words closer together", async () => {
    const [q, near, far] = await fakeEmbedder().embed(
      ["kubernetes experience", "Operated Kubernetes clusters", "Baked sourdough bread"],
      "document",
    );
    expect(cos(q!, near!)).toBeGreaterThan(cos(q!, far!));
  });
});

describe("voyageEmbedder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("batches requests and keeps input order", async () => {
    const calls: { input: string[]; output_dimension: number }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { input: string[]; output_dimension: number };
      calls.push(body);
      // Return out of order to prove we sort by index.
      const data = body.input.map((t, index) => ({ index, embedding: [t.length] })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const texts = Array.from({ length: 70 }, (_, i) => "x".repeat(i + 1));
    const out = await voyageEmbedder("key").embed(texts, "document");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.output_dimension).toBe(EMBEDDING_DIM);
    expect(out.map((v) => v[0])).toEqual(texts.map((t) => t.length));
  });

  it("surfaces HTTP failures without echoing the body", async () => {
    vi.stubGlobal("fetch", async () => new Response("secret document text", { status: 401 }));
    const err = await voyageEmbedder("key").embed(["a"], "query").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("secret");
  });
});
