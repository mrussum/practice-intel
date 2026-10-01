/**
 * Password hashing and session tokens on node:crypto, so there's no
 * third-party crypto dependency.
 *
 * Passwords: scrypt with a random 16-byte salt. The parameters are stored
 * in the hash string, so the cost can be raised later without invalidating
 * existing accounts.
 * Sessions: 32 random bytes in an httpOnly cookie. Only their SHA-256 is
 * stored, so a database leak doesn't hand out live sessions.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "ci_session";

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

// scrypt needs 128 * N * r bytes; allow that with headroom.
const memFor = (N: number, r: number) => 256 * N * r;

/** "scrypt$N$r$p$salt$hash" (base64url fields). */
export async function hashPassword(password: string, cost = 17): Promise<string> {
  const N = 2 ** cost;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r, p, maxmem: memFor(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const N = Number(n);
  const R = Number(r);
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), { N, r: R, p: Number(p), maxmem: memFor(N, R) });
  return timingSafeEqual(actual, expected);
}

/**
 * Checked when the email is unknown, so a failed login takes the same time
 * whether or not the account exists. Computed once per cost setting.
 */
const dummyHashes = new Map<number, Promise<string>>();
export function dummyHash(cost: number): Promise<string> {
  let h = dummyHashes.get(cost);
  if (!h) {
    h = hashPassword(randomBytes(16).toString("hex"), cost);
    dummyHashes.set(cost, h);
  }
  return h;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
