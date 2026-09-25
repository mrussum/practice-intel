import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocumentKind, DocumentSummary } from "@career-intel/shared";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

const ACCEPT = [".pdf", ".docx", ".txt", ".md"];
const MAX_BYTES = 5 * 1024 * 1024;

function checkFile(file: File): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
  if (!ACCEPT.includes(ext)) return `${file.name}: only PDF, DOCX, TXT or MD files are supported.`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than the 5MB limit.`;
  return null;
}

interface Upload {
  id: string;
  name: string;
  error?: string;
}

function DropZone({ kind, multiple, onFiles }: { kind: DocumentKind; multiple: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    onFiles(multiple ? files : files.slice(0, 1));
  };
  const label = kind === "resume" ? "Resume" : "Job descriptions";
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("rounded-lg border border-dashed p-3 text-center transition-colors", over ? "border-primary bg-primary/5" : "border-border")}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="mb-2 text-xs text-muted-foreground">Drop {multiple ? "files" : "a file"} or browse · PDF, DOCX, TXT, MD · 5MB</p>
      <Button variant="outline" size="sm" onClick={() => input.current?.click()} aria-label={`Upload ${label.toLowerCase()}`}>
        Choose {multiple ? "files" : "file"}
      </Button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={ACCEPT.join(",")}
        multiple={multiple}
        data-testid={`upload-${kind}`}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function DocumentsPanel({
  documents,
  loading,
  error,
  onOpenFit,
}: {
  documents: DocumentSummary[];
  loading: boolean;
  error: Error | null;
  onOpenFit: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
    void queryClient.invalidateQueries({ queryKey: ["fit"] });
    void queryClient.invalidateQueries({ queryKey: ["document"] });
  };

  const upload = async (kind: DocumentKind, files: File[]) => {
    // Sequential, so jobs get labels in the order they were chosen.
    for (const file of files) {
      const id = crypto.randomUUID();
      const problem = checkFile(file);
      setUploads((u) => [...u, { id, name: file.name, error: problem ?? undefined }]);
      if (problem) continue;
      try {
        await api.uploadDocument(kind, file);
        setUploads((u) => u.filter((x) => x.id !== id));
        invalidate();
      } catch (err) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: `${file.name}: ${(err as Error).message}` } : x)));
      }
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: invalidate,
  });

  const resume = documents.find((d) => d.kind === "resume");
  const jobs = documents.filter((d) => d.kind === "job");
  const pending = uploads.filter((u) => !u.error);

  const row = (d: DocumentSummary) => (
    <li key={d.id} className="group rounded-md border border-border bg-card p-2">
      <div className="flex items-start gap-2">
        <Badge variant={d.kind === "resume" ? "primary" : "default"}>{d.label}</Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={d.title}>{d.title}</p>
          <p className="truncate text-xs text-muted-foreground" title={d.filename}>
            {d.filename} · {d.chunkCount} sections
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${d.label}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${d.label} (${d.filename})? This removes it and its chunks.`)) remove.mutate(d.id);
          }}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
        </Button>
      </div>
      {d.kind === "job" ? (
        <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-primary" onClick={() => onOpenFit(d.id)}>
          View fit matrix →
        </Button>
      ) : null}
    </li>
  );

  return (
    <section aria-labelledby="documents-heading" className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 id="documents-heading" className="text-sm font-semibold">Documents</h2>
      <DropZone kind="resume" multiple={false} onFiles={(f) => void upload("resume", f)} />
      <DropZone kind="job" multiple onFiles={(f) => void upload("job", f)} />

      {pending.length > 0 ? (
        <ul aria-live="polite" className="space-y-1">
          {pending.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" label="Processing" /> Processing {u.name}…
            </li>
          ))}
        </ul>
      ) : null}
      {uploads.filter((u) => u.error).map((u) => (
        <Alert key={u.id} variant="destructive" className="flex items-start justify-between gap-2">
          <span>{u.error}</span>
          <button type="button" className="text-xs underline" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
            Dismiss
          </button>
        </Alert>
      ))}
      {remove.error ? <Alert variant="destructive">{remove.error.message}</Alert> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading documents…</p>
      ) : error ? (
        <Alert variant="destructive">{error.message}</Alert>
      ) : documents.length === 0 ? (
        <Alert>No documents yet. Upload your resume and one or more job descriptions to get started.</Alert>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Resume</h3>
            {resume ? <ul>{row(resume)}</ul> : <p className="text-xs text-muted-foreground">No resume yet.</p>}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Jobs ({jobs.length})</h3>
            {jobs.length ? <ul className="space-y-2">{jobs.map(row)}</ul> : <p className="text-xs text-muted-foreground">No job descriptions yet.</p>}
          </div>
        </div>
      )}
      <p className="mt-auto text-[11px] text-muted-foreground">
        Documents are stored only in this app's database and can be deleted at any time.
      </p>
    </section>
  );
}
