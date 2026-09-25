import { ChatEvent, type ChatRequest } from "@career-intel/shared";
import { API_URL } from "./api";

/**
 * Incremental parser for the `data: <json>\n\n` frames POST /chat emits.
 * Network chunks can split a frame anywhere, so text is buffered until a
 * blank line completes it. Frames that aren't valid ChatEvents are dropped
 * rather than crashing the UI.
 */
export function createSseParser() {
  let buffer = "";
  return {
    feed(chunk: string): ChatEvent[] {
      buffer += chunk.replace(/\r\n/g, "\n");
      const events: ChatEvent[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) {
          try {
            const parsed = ChatEvent.safeParse(JSON.parse(data));
            if (parsed.success) events.push(parsed.data);
          } catch {
            // Malformed JSON: skip the frame.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      return events;
    },
  };
}

/** POSTs a question and calls `onEvent` for each event until the stream ends or is aborted. */
export async function streamChat(req: ChatRequest, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    onEvent({ type: "error", message: body?.message ?? `Chat failed (HTTP ${res.status}).` });
    return;
  }
  const parser = createSseParser();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(value).forEach(onEvent);
  }
}
