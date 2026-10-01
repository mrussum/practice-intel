import { afterEach, describe, expect, it } from "vitest";
import { Me } from "@career-intel/shared";
import { buildApp } from "../src/app.js";
import { hashToken, SESSION_COOKIE } from "../src/lib/auth.js";
import { PASSWORD, sessionCookie, signUp, testConfig, testDeps } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function server(config = testConfig()) {
  const deps = testDeps();
  const app = await buildApp(config, deps);
  close = () => app.close();
  return { app, deps };
}

const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) => ({ method: "POST" as const, url, payload, headers });

describe("signup", () => {
  it("creates the account, normalises the email and sets a hardened session cookie", async () => {
    const { app } = await server();
    const res = await app.inject(post("/auth/signup", { email: "  Jordan@Example.com ", password: PASSWORD }));
    expect(res.statusCode).toBe(201);
    expect(Me.parse(res.json()).email).toBe("jordan@example.com");

    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie.maxAge).toBe(7 * 24 * 60 * 60);
    expect(cookie.secure).toBeUndefined(); // COOKIE_SECURE off for plain-HTTP localhost
  });

  it("marks the cookie Secure when COOKIE_SECURE=1", async () => {
    const { app } = await server(testConfig({ COOKIE_SECURE: "1" }));
    const res = await app.inject(post("/auth/signup", { email: "a@example.com", password: PASSWORD }));
    expect(res.cookies[0]).toMatchObject({ secure: true });
  });

  it("stores only a hash of the session token", async () => {
    const { app, deps } = await server();
    const res = await app.inject(post("/auth/signup", { email: "a@example.com", password: PASSWORD }));
    const token = res.cookies[0]!.value;
    expect(await deps.store.findAuthSession(token)).toBeNull();
    expect(await deps.store.findAuthSession(hashToken(token))).toMatchObject({ email: "a@example.com" });
  });

  it.each([
    [{ email: "not-an-email", password: PASSWORD }, /valid email/],
    [{ email: "a@example.com", password: "short" }, /10/],
    [{ email: "a@example.com" }, /10/],
  ])("rejects %j", async (body, message) => {
    const { app } = await server();
    const res = await app.inject(post("/auth/signup", body));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(message);
  });

  it("refuses a duplicate email (case-insensitively)", async () => {
    const { app } = await server();
    await app.inject(post("/auth/signup", { email: "a@example.com", password: PASSWORD }));
    const res = await app.inject(post("/auth/signup", { email: "A@EXAMPLE.COM", password: PASSWORD }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("email_taken");
  });
});

describe("login, me and logout", () => {
  it("logs in, identifies the user, and logout revokes the session server-side", async () => {
    const { app } = await server();
    await app.inject(post("/auth/signup", { email: "a@example.com", password: PASSWORD }));

    const login = await app.inject(post("/auth/login", { email: "a@example.com", password: PASSWORD }));
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login);

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ email: "a@example.com" });

    const logout = await app.inject(post("/auth/logout", {}, { cookie }));
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies[0]).toMatchObject({ name: SESSION_COOKIE, value: "" });
    // The old cookie is useless even if the browser kept it.
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { app } = await server();
    await app.inject(post("/auth/signup", { email: "a@example.com", password: PASSWORD }));
    const wrong = await app.inject(post("/auth/login", { email: "a@example.com", password: "wrong password!" }));
    const unknown = await app.inject(post("/auth/login", { email: "b@example.com", password: "wrong password!" }));
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects expired sessions", async () => {
    const { app, deps } = await server();
    const user = await signUp(app);
    await deps.store.createAuthSession(hashToken("expired-token"), user.userId, new Date(Date.now() - 1000));
    const res = await app.inject({ method: "GET", url: "/documents", headers: { cookie: `${SESSION_COOKIE}=expired-token` } });
    expect(res.statusCode).toBe(401);
  });

  it("rate-limits login attempts", async () => {
    const { app } = await server(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: "3" }));
    const codes = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await app.inject(post("/auth/login", { email: "a@example.com", password: "wrong password!" }))).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
  });
});

describe("protection", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it.each([
    ["GET", "/auth/me"],
    ["GET", "/documents"],
    ["POST", "/documents?kind=job"],
    ["GET", `/documents/${id}`],
    ["DELETE", `/documents/${id}`],
    ["GET", `/jobs/${id}/fit`],
    ["POST", "/chat"],
  ] as const)("%s %s requires a session", async (method, url) => {
    const { app } = await server();
    const res = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthenticated");
  });

  it("leaves health checks open", async () => {
    const { app } = await server();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
  });

  it("rejects state-changing requests from origins that aren't the web app", async () => {
    const { app } = await server(testConfig({ WEB_ORIGIN: "http://localhost:8080" }));
    const user = await signUp(app);
    const evil = await user.inject({ method: "POST", url: "/auth/logout", headers: { origin: "https://evil.example" } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toBe("forbidden_origin");
    const ok = await user.inject({ method: "POST", url: "/auth/logout", headers: { origin: "http://localhost:8080" } });
    expect(ok.statusCode).toBe(204);
    // Reads aren't checked: CORS already stops other origins from reading responses.
    expect((await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } })).statusCode).toBe(200);
  });

  it("allows credentialed CORS only for the web app's origin", async () => {
    const { app } = await server(testConfig({ WEB_ORIGIN: "http://localhost:8080" }));
    const res = await app.inject({ method: "OPTIONS", url: "/documents", headers: { origin: "http://localhost:8080", "access-control-request-method": "GET" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8080");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    const other = await app.inject({ method: "OPTIONS", url: "/documents", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
