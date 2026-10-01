import { Fragment, type ReactNode } from "react";
import type { Citation } from "@career-intel/shared";
import { citationNumbers, segmentAnswer } from "../lib/answer";

/** **bold** is the only inline markdown the prompts produce often enough to render. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function CitationButton({ citation, number, onSelect }: { citation: Citation; number: number; onSelect: (c: Citation) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(citation)}
      aria-label={`Citation ${number}: ${citation.documentLabel}`}
      title={`${citation.documentLabel}: ${citation.snippet}`}
      className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary/10 px-1 align-baseline text-[11px] font-semibold text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {number}
    </button>
  );
}

function Line({ text, citations, numbers, onSelect }: { text: string; citations: Citation[]; numbers: Map<string, number>; onSelect: (c: Citation) => void }) {
  return (
    <>
      {segmentAnswer(text, citations).map((s, i) =>
        s.kind === "text" ? (
          <Fragment key={i}>{inline(s.text)}</Fragment>
        ) : (
          <CitationButton key={i} citation={s.citation} number={numbers.get(s.citation.ref)!} onSelect={onSelect} />
        ),
      )}
    </>
  );
}

/**
 * Renders an answer: paragraphs, "- " bullet lists, **bold**, and verified
 * citation markers as numbered buttons that open the evidence panel.
 */
export function AnswerText({ text, citations, onSelect }: { text: string; citations: Citation[]; onSelect: (c: Citation) => void }) {
  const numbers = citationNumbers(citations);
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const isItem = /^\s*[-*•]\s+/.test(line);
    const content = isItem ? line.replace(/^\s*[-*•]\s+/, "") : line;
    const last = blocks.at(-1);
    if (last && last.list === isItem && isItem) last.lines.push(content);
    else blocks.push({ list: isItem, lines: [content] });
  }

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="ml-5 list-disc space-y-1">
            {b.lines.map((l, j) => (
              <li key={j}>
                <Line text={l} citations={citations} numbers={numbers} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Line text={b.lines[0]!} citations={citations} numbers={numbers} onSelect={onSelect} />
          </p>
        ),
      )}
    </div>
  );
}

export function SourceList({ citations, onSelect }: { citations: Citation[]; onSelect: (c: Citation) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Sources</p>
      <ol className="space-y-1">
        {citations.map((c, i) => (
          <li key={c.ref}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="shrink-0 font-semibold text-primary">{i + 1}</span>
              <span className="shrink-0 font-medium whitespace-nowrap">{c.documentLabel}</span>
              <span className="min-w-0 truncate text-muted-foreground">{c.snippet}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
