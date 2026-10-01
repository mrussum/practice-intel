import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Citation } from "@career-intel/shared";
import { AnswerText, SourceList } from "../src/components/AnswerText";
import { segmentAnswer } from "../src/lib/answer";

const citation = (ref: string, label = "Job #1"): Citation => ({
  ref,
  chunkId: "11111111-1111-4111-8111-11111111111" + ref.slice(1),
  documentId: "22222222-2222-4222-8222-222222222222",
  documentLabel: label,
  snippet: `snippet ${ref}`,
});

describe("segmentAnswer", () => {
  it("turns verified markers into citations and removes the rest", () => {
    const segs = segmentAnswer("Uses Go [C2] and Rust [C9].", [citation("C2")]);
    expect(segs).toEqual([
      { kind: "text", text: "Uses Go" },
      { kind: "cite", citation: citation("C2") },
      { kind: "text", text: " and Rust" },
      { kind: "text", text: "." },
    ]);
  });

  it("hides markers while streaming (no citations yet)", () => {
    const text = segmentAnswer("Missing Kubernetes [C1]", [])
      .map((s) => (s.kind === "text" ? s.text : "?"))
      .join("");
    expect(text).toBe("Missing Kubernetes");
  });
});

describe("AnswerText", () => {
  const render = (text: string, citations: Citation[]) =>
    renderToStaticMarkup(<AnswerText text={text} citations={citations} onSelect={() => {}} />);

  it("renders verified citations as numbered, labelled buttons in first-cited order", () => {
    const html = render("Strong TypeScript [C3]. Postgres too [C1][C3].", [citation("C3", "Resume"), citation("C1")]);
    expect(html).toContain('aria-label="Citation 1: Resume"');
    expect(html).toContain('aria-label="Citation 2: Job #1"');
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toContain("[C");
  });

  it("never renders a link for an unverified ref", () => {
    const html = render("Invented [C7].", [citation("C1")]);
    expect(html).not.toContain("<button");
    expect(html).toContain("Invented.");
  });

  it("renders bullet lists and bold text", () => {
    const html = render("Gaps:\n- **Kubernetes** [C1]\n- Rust", [citation("C1")]);
    expect(html).toContain("<ul");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("<strong>Kubernetes</strong>");
  });

  it("escapes HTML in model output", () => {
    const html = render("<img src=x onerror=alert(1)>", []);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("SourceList", () => {
  it("lists each cited source once with its document label", () => {
    const html = renderToStaticMarkup(<SourceList citations={[citation("C1", "Resume"), citation("C2")]} onSelect={() => {}} />);
    expect(html).toContain("Sources");
    expect(html).toContain("Resume");
    expect(html).toContain("snippet C2");
  });

  it("renders nothing without citations", () => {
    expect(renderToStaticMarkup(<SourceList citations={[]} onSelect={() => {}} />)).toBe("");
  });
});
