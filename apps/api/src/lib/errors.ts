/** An error whose message is safe and useful to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** An upstream AI provider (LLM or embeddings) failed or was unreachable. */
export class AiProviderError extends Error {}

/**
 * Log serializer for errors. Database errors embed query parameters (i.e.
 * document text) in their message and fields, and provider errors can echo
 * request bodies, so only the type, a bounded message and the code are kept.
 */
export function safeErrorForLog(err: unknown): { type: string; message: string; stack: string; code?: unknown } {
  if (!(err instanceof Error)) return { type: typeof err, message: String(err).slice(0, 200), stack: "" };
  const cause = (err as { cause?: unknown }).cause;
  const source = err.name === "DrizzleQueryError" && cause instanceof Error ? cause : err;
  return {
    type: err.name,
    message: (source.message.split("\n")[0] ?? "").slice(0, 300),
    code: (source as { code?: unknown }).code,
    // Frames only: the stack's first lines repeat the (unsafe) message.
    stack: (err.stack ?? "").split("\n").filter((l) => l.trimStart().startsWith("at ")).slice(0, 5).join("\n"),
  };
}
