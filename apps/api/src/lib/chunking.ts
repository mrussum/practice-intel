/**
 * Structure-aware chunking for resumes and job descriptions.
 *
 * Why not fixed-size windows: these documents are short and sectioned. A
 * 512-token window splits a job entry across chunks and mixes "Requirements"
 * with "Benefits", which hurts both retrieval and citations. Splitting on
 * headings keeps each chunk a meaningful unit the UI can cite.
 *
 * Deliberately simple heuristics — replace with better parsing only if the
 * eval set shows it matters.
 */

export interface RawChunk {
  section: string;
  text: string;
}

const HEADING_ALIASES: Record<string, string> = {
  experience: "experience",
  "work experience": "experience",
  employment: "experience",
  "professional experience": "experience",
  skills: "skills",
  "technical skills": "skills",
  education: "education",
  projects: "projects",
  summary: "summary",
  profile: "summary",
  requirements: "requirements",
  "what you'll need": "requirements",
  "about you": "requirements",
  qualifications: "requirements",
  "nice to have": "nice_to_have",
  "bonus points": "nice_to_have",
  responsibilities: "responsibilities",
  "what you'll do": "responsibilities",
  benefits: "benefits",
};

/** Returns the canonical section name if the line looks like a heading. */
export function detectHeading(line: string): string | null {
  const cleaned = line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[:\-–]+$/, "")
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned.length > 40) return null;
  return HEADING_ALIASES[cleaned] ?? null;
}

/** Split into sections, then split sections into paragraph-level chunks. */
export function chunkByStructure(text: string, maxChars = 1200): RawChunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: { section: string; body: string[] }[] = [{ section: "header", body: [] }];

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) sections.push({ section: heading, body: [] });
    else sections.at(-1)!.body.push(line);
  }

  const chunks: RawChunk[] = [];
  for (const { section, body } of sections) {
    const paragraphs = body
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = "";
    for (const p of paragraphs) {
      if (buffer && buffer.length + p.length + 2 > maxChars) {
        chunks.push({ section, text: buffer });
        buffer = "";
      }
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
    if (buffer) chunks.push({ section, text: buffer });
  }
  return chunks;
}
