import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export interface EvidenceTarget {
  documentId: string;
  chunkId: string;
}

const SECTION_LABEL: Record<string, string> = {
  header: "Header",
  nice_to_have: "Nice to have",
};
const sectionLabel = (s: string) => SECTION_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Shows the whole source document with the cited chunk highlighted and scrolled into view. */
export function EvidencePanel({ target, onClose }: { target: EvidenceTarget | null; onClose?: () => void }) {
  const doc = useQuery({
    queryKey: ["document", target?.documentId],
    queryFn: () => api.getDocument(target!.documentId),
    enabled: !!target,
  });
  const highlighted = useRef<HTMLElement>(null);

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    highlighted.current?.focus({ preventScroll: true });
  }, [target?.chunkId, doc.data]);

  return (
    <section aria-labelledby="evidence-heading" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 id="evidence-heading" className="text-sm font-semibold">Evidence</h2>
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close evidence panel">Close</Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!target ? (
          <p className="text-sm text-muted-foreground">Click a numbered citation in an answer, or evidence in the fit matrix, to see the exact source passage here.</p>
        ) : doc.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading source…</p>
        ) : doc.error ? (
          <Alert variant="destructive">{doc.error.message}</Alert>
        ) : doc.data ? (
          <article aria-label={`${doc.data.label}: ${doc.data.title}`} className="space-y-3">
            <header className="space-y-1">
              <Badge variant={doc.data.kind === "resume" ? "primary" : "default"}>{doc.data.label}</Badge>
              <p className="text-sm font-semibold">{doc.data.title}</p>
              <p className="text-xs text-muted-foreground">{doc.data.filename}</p>
            </header>
            {!doc.data.chunks.some((c) => c.id === target.chunkId) ? (
              <Alert>This passage is no longer in the document. It may have been re-uploaded.</Alert>
            ) : null}
            {doc.data.chunks.map((c) => {
              const active = c.id === target.chunkId;
              return (
                <section
                  key={c.id}
                  ref={active ? highlighted : undefined}
                  tabIndex={active ? -1 : undefined}
                  aria-current={active ? "true" : undefined}
                  data-testid={active ? "highlighted-chunk" : undefined}
                  className={cn(
                    "rounded-md border p-2 text-sm whitespace-pre-wrap outline-none",
                    active ? "border-partial/50 bg-highlight ring-2 ring-partial/40" : "border-transparent text-muted-foreground",
                  )}
                >
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{sectionLabel(c.section)}</p>
                  {c.text}
                </section>
              );
            })}
          </article>
        ) : null}
      </div>
    </section>
  );
}
