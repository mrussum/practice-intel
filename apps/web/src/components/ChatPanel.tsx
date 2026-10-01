import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Citation, Intent } from "@career-intel/shared";
import { streamChat } from "../lib/sse";
import { cn } from "../lib/cn";
import { AnswerText, SourceList } from "./AnswerText";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent?: Intent;
  citations: Citation[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

const INTENT_LABEL: Record<Intent, string> = {
  fit: "Fit",
  gaps: "Skill gaps",
  compare: "Compare",
  interview_prep: "Interview prep",
  general: "General",
  off_topic: "Off topic",
};

export function suggestionsFor(jobLabels: string[]): { intent: Intent; questions: string[] }[] {
  const first = jobLabels[0] ?? "Job #1";
  return [
    { intent: "fit", questions: [`How well does my experience align with ${first}?`, "What are my strongest selling points?"] },
    { intent: "gaps", questions: [`What skills am I missing for ${first}?`, "Which gaps matter most across all jobs?"] },
    ...(jobLabels.length > 1
      ? [{ intent: "compare" as const, questions: ["Which job am I the best fit for, and why?", `Compare ${jobLabels.slice(0, 2).join(" and ")}`] }]
      : []),
    { intent: "interview_prep", questions: [`What interview questions should I prepare for ${first}?`, "Which projects should I talk about in interviews?"] },
  ];
}

export function ChatPanel({
  sessionId,
  jobLabels,
  hasResume,
  onNewChat,
  onCitation,
}: {
  sessionId: string;
  jobLabels: string[];
  hasResume: boolean;
  onNewChat: () => void;
  onCitation: (c: Citation) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const streaming = messages.some((m) => m.status === "streaming");

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // A new session starts with an empty transcript.
  useEffect(() => {
    abort.current?.abort();
    setMessages([]);
  }, [sessionId]);

  const update = (id: string, fn: (m: Message) => Message) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    const assistantId = crypto.randomUUID();
    setMessages((ms) => [
      ...ms,
      { id: crypto.randomUUID(), role: "user", text: message, citations: [], status: "done" },
      { id: assistantId, role: "assistant", text: "", citations: [], status: "streaming" },
    ]);
    setInput("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat(
        { sessionId, message },
        (e) => {
          if (e.type === "intent") update(assistantId, (m) => ({ ...m, intent: e.intent }));
          else if (e.type === "token") update(assistantId, (m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "citations") update(assistantId, (m) => ({ ...m, citations: e.citations }));
          else if (e.type === "done") update(assistantId, (m) => ({ ...m, status: "done" }));
          else if (e.type === "error") update(assistantId, (m) => ({ ...m, status: "error", error: e.message }));
        },
        controller.signal,
      );
      update(assistantId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
    } catch (err) {
      const stopped = controller.signal.aborted;
      update(assistantId, (m) => ({
        ...m,
        status: stopped ? "stopped" : "error",
        error: stopped ? undefined : "Couldn't reach the API. Check it is running and try again.",
      }));
      if (!stopped) console.warn(err);
    } finally {
      abort.current = null;
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const groups = suggestionsFor(jobLabels);
  const lastIntent = [...messages].reverse().find((m) => m.intent)?.intent;
  const followUps = groups.find((g) => g.intent === lastIntent)?.questions ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text;

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-busy={streaming}>
        {!hasResume || jobLabels.length === 0 ? (
          <Alert>
            {!hasResume && jobLabels.length === 0
              ? "Upload a resume and at least one job description to get grounded answers."
              : !hasResume
                ? "Upload your resume so answers can compare it against the jobs."
                : "Upload at least one job description to compare against."}
          </Alert>
        ) : null}

        {messages.length === 0 ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">Ask about your fit</h2>
              <p className="text-sm text-muted-foreground">Answers are grounded in your documents, with numbered citations you can click to see the source.</p>
            </div>
            {groups.map((g) => (
              <div key={g.intent}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{INTENT_LABEL[g.intent]}</p>
                <div className="flex flex-wrap gap-2">
                  {g.questions.map((q) => (
                    <Button key={q} variant="outline" size="sm" className="h-auto py-1.5 text-left whitespace-normal" onClick={() => void send(q)}>
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ol className="space-y-4">
            {messages.map((m) => (
              <li key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{m.text}</div>
                ) : (
                  <article aria-label="Assistant answer" className="w-full max-w-[95%] rounded-lg border border-border bg-card px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      {m.intent ? <Badge variant="primary">{INTENT_LABEL[m.intent]}</Badge> : null}
                      {m.status === "streaming" ? <span className="text-xs text-muted-foreground">{m.text ? "Writing…" : "Reading your documents…"}</span> : null}
                      {m.status === "stopped" ? <span className="text-xs text-muted-foreground">Stopped</span> : null}
                    </div>
                    {m.text ? <AnswerText text={m.text} citations={m.citations} onSelect={onCitation} /> : null}
                    {m.status === "error" ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Alert variant="destructive" className="flex-1">{m.error}</Alert>
                        {lastUser ? <Button size="sm" variant="outline" onClick={() => void send(lastUser)}>Retry</Button> : null}
                      </div>
                    ) : null}
                    <SourceList citations={m.citations} onSelect={onCitation} />
                  </article>
                )}
              </li>
            ))}
          </ol>
        )}
        {!streaming && followUps.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Suggested follow-ups">
            {followUps.map((q) => (
              <Button key={q} variant="outline" size="sm" className="h-auto py-1 text-xs whitespace-normal" onClick={() => void send(q)}>
                {q}
              </Button>
            ))}
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-border bg-card p-3">
        <label htmlFor="chat-input" className="sr-only">Ask a question</label>
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 2000))}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask about fit, gaps, or interview prep… (Enter to send, Shift+Enter for a new line)"
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onNewChat} disabled={streaming || messages.length === 0}>New chat</Button>
            <span className="text-xs text-muted-foreground">{input.length}/2000</span>
          </div>
          {streaming ? (
            <Button variant="outline" onClick={() => abort.current?.abort()}>Stop</Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>Send</Button>
          )}
        </div>
      </form>
    </section>
  );
}
