import { useQueries } from "@tanstack/react-query";
import type { DocumentSummary, FitRow } from "@career-intel/shared";
import { api } from "../lib/api";
import { Alert } from "./ui/alert";
import { Spinner } from "./ui/spinner";
import { StatusChip, summarizeFit } from "./FitMatrix";

const MAX_ROWS = 15;
const key = (skill: string) => skill.trim().toLowerCase();

/**
 * Rows are the requirements that appear in the most jobs (must-haves first),
 * so the grid shows where the jobs overlap and where they differ.
 */
export function buildCompareRows(fits: { jobId: string; rows: FitRow[] }[]) {
  const byKey = new Map<string, { skill: string; jobs: number; must: number; cells: Map<string, FitRow> }>();
  for (const { jobId, rows } of fits) {
    for (const row of rows) {
      const k = key(row.requirement.skill);
      const entry = byKey.get(k) ?? { skill: row.requirement.skill, jobs: 0, must: 0, cells: new Map() };
      if (!entry.cells.has(jobId)) {
        entry.jobs++;
        if (row.requirement.priority === "must") entry.must++;
        entry.cells.set(jobId, row);
      }
      byKey.set(k, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.jobs - a.jobs || b.must - a.must || a.skill.localeCompare(b.skill)).slice(0, MAX_ROWS);
}

export function CompareView({ jobs, resume }: { jobs: DocumentSummary[]; resume?: DocumentSummary }) {
  const results = useQueries({
    queries: jobs.map((j) => ({
      queryKey: ["fit", j.id, resume?.id],
      queryFn: () => api.getFit(j.id),
      enabled: !!resume,
      staleTime: Infinity,
    })),
  });

  if (jobs.length === 0) return <Alert>Upload job descriptions to compare them side by side.</Alert>;
  if (!resume) return <Alert>Upload your resume to compare jobs against it.</Alert>;
  if (results.some((r) => r.isLoading)) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Assessing {jobs.length} jobs… (first time only)</p>;
  }
  const failed = results.find((r) => r.error);
  if (failed?.error) return <Alert variant="destructive">{failed.error.message}</Alert>;

  const fits = jobs.map((j, i) => ({ jobId: j.id, rows: results[i]?.data ?? [] }));
  const rows = buildCompareRows(fits);

  return (
    <div className="space-y-3">
      {jobs.length === 1 ? <Alert>Upload another job description to make the comparison useful.</Alert> : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <caption className="sr-only">Key requirements across jobs, with how well your resume covers each</caption>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th scope="col" className="p-2 text-left font-medium">Requirement</th>
              {jobs.map((j, i) => {
                const s = summarizeFit(fits[i]!.rows);
                return (
                  <th key={j.id} scope="col" className="p-2 text-left font-medium">
                    <div>{j.label}</div>
                    <div className="max-w-[180px] truncate text-xs font-normal text-muted-foreground" title={j.title}>{j.title}</div>
                    <div className="text-xs font-normal text-muted-foreground">{s.mustMet}/{s.must} must-haves met</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.skill} className="border-b border-border last:border-0">
                <th scope="row" className="p-2 text-left font-normal">{r.skill}</th>
                {jobs.map((j) => {
                  const cell = r.cells.get(j.id);
                  return (
                    <td key={j.id} className="p-2">
                      {cell ? (
                        <span className="inline-flex items-center gap-1" title={cell.rationale}>
                          <StatusChip status={cell.status} />
                          {cell.requirement.priority === "nice" ? <span className="text-[11px] text-muted-foreground">nice</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground" aria-label="Not required">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Showing the {rows.length} requirements shared by the most jobs. "—" means the job doesn't list it.</p>
    </div>
  );
}
