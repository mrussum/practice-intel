import type { Citation } from "@career-intel/shared";

export type Segment = { kind: "text"; text: string } | { kind: "cite"; citation: Citation };

/**
 * Splits answer text around [C3]-style markers. A marker becomes a citation
 * only if the server verified it (it's in `citations`). Unverified markers
 * are removed, and while streaming (before citations arrive) all markers are
 * hidden, so raw refs never flash on screen.
 */
export function segmentAnswer(text: string, citations: Citation[]): Segment[] {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\s?\[(C\d+)\]/g)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const citation = byRef.get(match[1]!);
    if (citation) segments.push({ kind: "cite", citation });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Stable display number for each cited chunk: first citation is 1, and so on. */
export function citationNumbers(citations: Citation[]): Map<string, number> {
  return new Map(citations.map((c, i) => [c.ref, i + 1]));
}
