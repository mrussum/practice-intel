import { z } from "zod";

// Empty strings from .env files ("KEY=") mean "unset", not "set to empty".
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const flag = z.preprocess((v) => v === "1" || v === "true", z.boolean());

/** Fail fast on bad config: a clear startup error beats a confusing runtime one. */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  /** Comma-separated list of allowed browser origins. */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: optionalString,

  FAKE_AI: flag,
  ANTHROPIC_API_KEY: optionalString,
  ANSWER_MODEL: z.string().default("claude-sonnet-5"),
  FAST_MODEL: z.string().default("claude-haiku-4-5"),
  /** Effort for answers. Use "none" if ANSWER_MODEL doesn't accept effort (e.g. Haiku 4.5). */
  ANSWER_EFFORT: z.enum(["none", "low", "medium", "high"]).default("low"),

  EMBEDDING_PROVIDER: z.enum(["voyage", "openai", "fake"]).default("voyage"),
  EMBEDDING_MODEL: optionalString,
  VOYAGE_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,

  UPLOAD_MAX_BYTES: z.coerce.number().default(5 * 1024 * 1024),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(20),
  /** Approximate tokens of conversation history sent with each question. */
  HISTORY_TOKEN_BUDGET: z.coerce.number().default(2000),

  LANGFUSE_PUBLIC_KEY: optionalString,
  LANGFUSE_SECRET_KEY: optionalString,
  LANGFUSE_HOST: optionalString,
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Real models only when explicitly possible; otherwise deterministic fakes. */
export function aiMode(config: Config): "real" | "fake" {
  return config.FAKE_AI || !config.ANTHROPIC_API_KEY ? "fake" : "real";
}

export function embeddingMode(config: Config): "real" | "fake" {
  if (config.FAKE_AI || config.EMBEDDING_PROVIDER === "fake") return "fake";
  const key = config.EMBEDDING_PROVIDER === "voyage" ? config.VOYAGE_API_KEY : config.OPENAI_API_KEY;
  return key ? "real" : "fake";
}
