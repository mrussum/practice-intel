import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "../src/lib/auth.js";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery", 10);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts each hash and records its parameters", async () => {
    const a = await hashPassword("same password!", 10);
    const b = await hashPassword("same password!", 10);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
  });

  it("verifies hashes made at a different cost, so the cost can be raised later", async () => {
    const old = await hashPassword("legacy password", 11);
    expect(await verifyPassword("legacy password", old)).toBe(true);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    for (const bad of ["", "bcrypt$x", "scrypt$1024$8$1$salt", "scrypt$1024$8$1$c2FsdA$c2hvcnQ"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("session tokens", () => {
  it("are long, random and stored only as a SHA-256 hash", () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[\w-]{43}$/);
    expect(newSessionToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});
