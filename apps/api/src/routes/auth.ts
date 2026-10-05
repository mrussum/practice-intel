import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Credentials, DeleteAccount, type Me } from "@career-intel/shared";
import type { Config } from "../config.js";
import type { Deps } from "../deps.js";
import { dummyHash, hashPassword, hashToken, newSessionToken, SESSION_COOKIE, SESSION_TTL_MS, verifyPassword } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/** The signed-in user; only valid on routes behind `authenticate`. */
export function userOf(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Log in to continue.");
  return req.user;
}

/** onRequest hook for protected routes: resolves the session cookie or rejects with 401. */
export function authenticate(deps: Deps) {
  return async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    const session = token ? await deps.store.findAuthSession(hashToken(token)) : null;
    if (!session) throw new HttpError(401, "unauthenticated", "Your session has expired or you're not logged in. Log in to continue.");
    req.user = { id: session.userId, email: session.email };
    // Every later log line carries the user id (never the email).
    req.log = req.log.child({ userId: session.userId });
  };
}

function parseCredentials(body: unknown) {
  const parsed = Credentials.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.path[0] === "password"
      ? "Password must be 10–200 characters."
      : "Enter a valid email address.";
    throw new HttpError(400, "invalid_credentials_format", message);
  }
  return parsed.data;
}

export async function authRoutes(app: FastifyInstance, { deps, config }: { deps: Deps; config: Config }) {
  // Tight limit: these endpoints are the brute-force and enumeration surface.
  const limited = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } } };

  const startSession = async (reply: FastifyReply, user: AuthUser) => {
    const token = newSessionToken();
    await deps.store.createAuthSession(hashToken(token), user.id, new Date(Date.now() + SESSION_TTL_MS));
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, // unreadable by page scripts
      sameSite: "lax", // not sent on cross-site subrequests
      secure: config.COOKIE_SECURE,
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  };

  app.post("/auth/signup", limited, async (req, reply): Promise<Me> => {
    const { email, password } = parseCredentials(req.body);
    const user = await deps.store.createUser(email, await hashPassword(password, config.PASSWORD_HASH_COST));
    if (!user) throw new HttpError(409, "email_taken", "An account with this email already exists. Log in instead.");
    await startSession(reply, user);
    req.log.info({ userId: user.id }, "user signed up");
    reply.code(201);
    return user;
  });

  app.post("/auth/login", limited, async (req, reply): Promise<Me> => {
    const { email, password } = parseCredentials(req.body);
    const user = await deps.store.findUserByEmail(email);
    // Always run one scrypt verification so timing doesn't reveal unknown emails.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash(config.PASSWORD_HASH_COST)));
    if (!user || !ok) {
      req.log.info("login failed");
      throw new HttpError(401, "invalid_login", "Email or password is incorrect.");
    }
    await deps.store.deleteExpiredAuthSessions(user.id);
    await startSession(reply, user);
    req.log.info({ userId: user.id }, "user logged in");
    return { id: user.id, email: user.email };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deps.store.deleteAuthSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  // Right to erasure: removes the account and all its data in one transaction.
  app.delete("/auth/account", { ...limited, onRequest: authenticate(deps) }, async (req, reply) => {
    const parsed = DeleteAccount.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "password_required", "Enter your password to confirm deleting your account.");
    const user = userOf(req);
    const record = await deps.store.findUserByEmail(user.email);
    if (!record || !(await verifyPassword(parsed.data.password, record.passwordHash))) {
      throw new HttpError(401, "invalid_password", "Password is incorrect. Your account was not deleted.");
    }
    await deps.store.deleteUser(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    req.log.info("account deleted");
    return reply.code(204).send();
  });

  app.get("/auth/me", { onRequest: authenticate(deps) }, async (req): Promise<Me> => userOf(req));
}
