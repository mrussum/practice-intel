import { useQuery } from "@tanstack/react-query";
import type { DocumentSummary, FitRow, FitStatus } from "@career-intel/shared";
import { api, RequestError } from "../lib/api";
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
    <li className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.requirement.skill}</p>
          <p className="text-xs text-muted-foreground">{row.requirement.text}</p>
        </div>
        <StatusChip status={row.status} />
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                  className="w-full rounded border border-border bg-muted/50 p-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <Card>
            <CardHeader>
              <CardTitle>Overall</CardTitle>
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
              </div>
            </CardContent>
          </Card>
          {groups.filter((g) => g.rows.length).map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title} ({g.rows.length})</h3>
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
