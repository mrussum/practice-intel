import type { JobProfile } from "@career-intel/shared";

export interface MentionableDoc {
  id: string;
  kind: "resume" | "job";
  label: string;
  title: string;
  profile: unknown;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which jobs does the message name? Matches labels ("Job #2", "job 2"),
 * job titles and company names, case-insensitively and on word boundaries.
 * Resolving this before retrieval turns "gaps for Job #2" into a hard filter
 * instead of hoping similarity search finds the right document.
 */
export function resolveMentions(message: string, docs: MentionableDoc[]): string[] {
  const text = message.toLowerCase();
  const numbers = new Set([...text.matchAll(/\bjob\s*(?:#|no\.?|number)?\s*(\d+)\b/g)].map((m) => Number(m[1])));
  const phrase = (p: string | undefined) =>
    !!p && p.length >= 3 && new RegExp(`(^|\\W)${escapeRe(p.toLowerCase())}(\\W|$)`).test(text);

  return docs
    .filter((d) => d.kind === "job")
    .filter((d) => {
      const n = Number(d.label.match(/#(\d+)/)?.[1]);
      const company = (d.profile as Partial<JobProfile>).company;
      return numbers.has(n) || phrase(d.title) || phrase(company);
    })
    .map((d) => d.id);
}
