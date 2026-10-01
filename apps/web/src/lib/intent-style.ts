import type { Intent } from "@career-intel/shared";
import type { BadgeVariant } from "../components/ui/badge";

/**
 * One colour per kind of question, used for the intent badge, the answer's
 * accent border and the suggested-question groups, so users can see at a
 * glance which kind of answer they're reading.
 */
export const INTENT_STYLE: Record<Intent, { label: string; badge: BadgeVariant; border: string; dot: string; chip: string }> = {
  fit: { label: "Fit", badge: "sky", border: "border-l-sky-500", dot: "bg-sky-500", chip: "hover:border-sky-300 hover:bg-sky-50" },
  gaps: { label: "Skill gaps", badge: "amber", border: "border-l-amber-500", dot: "bg-amber-500", chip: "hover:border-amber-300 hover:bg-amber-50" },
  compare: { label: "Compare", badge: "violet", border: "border-l-violet-500", dot: "bg-violet-500", chip: "hover:border-violet-300 hover:bg-violet-50" },
  interview_prep: { label: "Interview prep", badge: "emerald", border: "border-l-emerald-500", dot: "bg-emerald-500", chip: "hover:border-emerald-300 hover:bg-emerald-50" },
  general: { label: "General", badge: "slate", border: "border-l-slate-400", dot: "bg-slate-400", chip: "hover:border-slate-300 hover:bg-slate-50" },
  off_topic: { label: "Off topic", badge: "default", border: "border-l-slate-300", dot: "bg-slate-300", chip: "hover:bg-muted" },
};
