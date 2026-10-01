import { useQuery } from "@tanstack/react-query";
import type { DocumentSummary, FitRow, FitStatus } from "@career-intel/shared";
import { api, RequestError } from "../lib/api";
import { cn } from "../lib/cn";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Spinner } from "./ui/spinner";
import type { EvidenceTarget } from "./EvidencePanel";

export const STATUS_LABEL: Record<FitStatus, string> = { met: "Met", partial: "Partial", missing: "Missing" };

export function StatusChip({ status }: { status: FitStatus }) {
  return <Badge variant={status}>{STATUS_LABEL[status]}</Badge>;
}

export function summarizeFit(rows: FitRow[]) {
  const count = (priority: "must" | "nice", status: FitStatus) =>
    rows.filter((r) => r.requirement.priority === priority && r.status === status).length;
  const must = rows.filter((r) => r.requirement.priority === "must").length;
  return {
    must,
    mustMet: count("must", "met"),
    mustPartial: count("must", "partial"),
    mustMissing: count("must", "missing"),
    nice: rows.length - must,
    niceMet: count("nice", "met"),
  };
}

function RequirementRow({ row, resumeChunks, onEvidence, resumeId }: { row: FitRow; resumeChunks: Map<string, string>; resumeId?: string; onEvidence: (t: EvidenceTarget) => void }) {
  return (
    <li
      className={cn(
        "rounded-lg border border-l-4 border-border bg-card p-3 shadow-sm",
        row.status === "met" ? "border-l-emerald-500" : row.status === "partial" ? "border-l-amber-500" : "border-l-rose-500",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.requirement.skill}</p>
          <p className="text-xs text-muted-foreground">{row.requirement.text}</p>
        </div>
        <StatusChip status={row.status} />
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Why{row.evidenceChunkIds.length ? ` · ${row.evidenceChunkIds.length} evidence` : ""}
        </summary>
        <p className="mt-1 text-sm">{row.rationale}</p>
        {row.evidenceChunkIds.length > 0 && resumeId ? (
          <ul className="mt-2 space-y-1">
            {row.evidenceChunkIds.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onEvidence({ documentId: resumeId, chunkId: id })}
                  className="w-full rounded-md border border-indigo-100 bg-indigo-50/50 p-2 text-left text-xs hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {(resumeChunks.get(id) ?? "Resume passage").slice(0, 220)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  );
}

export function FitMatrix({
  jobs,
  jobId,
  resume,
  onSelectJob,
  onEvidence,
}: {
  jobs: DocumentSummary[];
  jobId: string | null;
  resume?: DocumentSummary;
  onSelectJob: (id: string) => void;
  onEvidence: (t: EvidenceTarget) => void;
}) {
  const selected = jobs.find((j) => j.id === jobId) ?? jobs[0];
  const fit = useQuery({
    queryKey: ["fit", selected?.id, resume?.id],
    queryFn: () => api.getFit(selected!.id),
    enabled: !!selected && !!resume,
    staleTime: Infinity, // the server caches until documents change; we invalidate on upload/delete
  });
  const resumeDoc = useQuery({
    queryKey: ["document", resume?.id],
    queryFn: () => api.getDocument(resume!.id),
    enabled: !!resume,
  });
  const resumeChunks = new Map((resumeDoc.data?.chunks ?? []).map((c) => [c.id, c.text]));

  if (jobs.length === 0) return <Alert>Upload a job description to see how your resume matches its requirements.</Alert>;
  if (!resume) return <Alert>Upload your resume to compute the fit matrix.</Alert>;

  const rows = fit.data ?? [];
  const s = summarizeFit(rows);
  const groups = [
    { title: "Must-have", rows: rows.filter((r) => r.requirement.priority === "must") },
    { title: "Nice-to-have", rows: rows.filter((r) => r.requirement.priority === "nice") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="fit-job" className="text-sm font-medium">Job</label>
        <select
          id="fit-job"
          value={selected?.id}
          onChange={(e) => onSelectJob(e.target.value)}
          className="h-9 rounded-md border border-border bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.label}: {j.title}</option>
          ))}
        </select>
      </div>

      {fit.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Assessing each requirement against your resume… (first time only)</p>
      ) : fit.error ? (
        <Alert variant="destructive">{fit.error instanceof RequestError ? fit.error.message : "Couldn't compute the fit matrix."}</Alert>
      ) : rows.length === 0 ? (
        <Alert>No requirements were found in this job description.</Alert>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div aria-hidden className="h-1 bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500" />
            <CardHeader>
              <CardTitle className="text-indigo-950">Overall</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <strong>{s.mustMet} of {s.must}</strong> must-haves met
                {s.mustPartial ? `, ${s.mustPartial} partial` : ""}
                {s.mustMissing ? `, ${s.mustMissing} missing` : ""}.
                {s.nice ? ` ${s.niceMet} of ${s.nice} nice-to-haves met.` : ""}
              </p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="bg-met" style={{ width: `${(s.mustMet / Math.max(s.must, 1)) * 100}%` }} />
                <div className="bg-partial" style={{ width: `${(s.mustPartial / Math.max(s.must, 1)) * 100}%` }} />
                <div className="bg-missing/70" style={{ width: `${(s.mustMissing / Math.max(s.must, 1)) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground" aria-hidden>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-met" /> Met</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-partial" /> Partial</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-missing/70" /> Missing</span>
              </div>
            </CardContent>
          </Card>
          {groups.filter((g) => g.rows.length).map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", g.title === "Must-have" ? "text-indigo-700" : "text-sky-700")}>
                {g.title} ({g.rows.length})
              </h3>
              <ul className="space-y-2">
                {g.rows.map((r, i) => (
                  <RequirementRow key={`${r.requirement.skill}-${i}`} row={r} resumeChunks={resumeChunks} resumeId={resume.id} onEvidence={onEvidence} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
