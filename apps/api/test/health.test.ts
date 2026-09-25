import { afterEach, describe, expect, it } from "vitest";
import { ReadyResponse } from "@career-intel/shared";
import { testApp } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

describe("health", () => {
  it("GET /health returns ok", async () => {
    const { app } = await testApp();
    close = () => app.close();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready reports store and AI mode", async () => {
    const { app } = await testApp();
    close = () => app.close();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(ReadyResponse.parse(res.json())).toEqual({ status: "ready", store: "memory", ai: "fake", embeddings: "fake" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("GET /ready returns 503 when the store is down", async () => {
    const { app, deps } = await testApp();
    close = () => app.close();
    deps.store.ping = async () => {
      throw new Error("connection refused");
    };
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("unavailable");
  });
});
