// lib/builder-wizard.test.ts
import { getWizardQuestions, answersToMarkdown } from "@/lib/builder-wizard";

describe("getWizardQuestions", () => {
  it("returns section-specific questions", () => {
    const q = getWizardQuestions("Strategy memo", "thesis");
    expect(q.map((x) => x.id)).toContain("targets");
  });

  it("uses the marketing set for executive summaries and one-pagers by name", () => {
    expect(getWizardQuestions("Executive Summary", "overview").some((q) => q.id === "ask")).toBe(true);
    expect(getWizardQuestions("Firm One-Pager", "other").some((q) => q.id === "ask")).toBe(true);
  });

  it("falls back to the generic set for unknown sections", () => {
    const q = getWizardQuestions("Mystery", "references");
    expect(q.map((x) => x.id)).toEqual(["purpose", "audience", "key_points", "constraints"]);
  });
});

describe("answersToMarkdown", () => {
  const qs = [
    { id: "a", label: "First thing?" },
    { id: "b", label: "Second thing?" },
  ];

  it("renders answered questions as sections and skips blanks", () => {
    const md = answersToMarkdown("Doc", qs, { a: "Alpha", b: "" });
    expect(md).toContain("# Doc");
    expect(md).toContain("## First thing");
    expect(md).toContain("Alpha");
    expect(md).not.toContain("## Second thing");
  });

  it("returns a TODO placeholder when nothing was answered", () => {
    expect(answersToMarkdown("Doc", qs, {})).toContain("[TODO");
  });
});
