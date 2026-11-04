import { documentGaps, rankIssues, toRedFlagHandoff } from "./dd-issues";

describe("rankIssues", () => {
  it("ranks red before amber before green, then by evidence strength", () => {
    const r = rankIssues([
      { title: "C", rating: "green", documentRef: "d" },
      {
        title: "B-weak",
        rating: "amber",
        documentRef: "d",
        evidenceGrade: "C",
      },
      {
        title: "B-strong",
        rating: "amber",
        documentRef: "d",
        evidenceGrade: "A",
      },
      { title: "A", rating: "red", documentRef: "d" },
    ]);
    expect(r.issues.map((i) => i.title)).toEqual([
      "A",
      "B-strong",
      "B-weak",
      "C",
    ]);
    expect(r.issues.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
    expect(r.counts).toEqual({ red: 1, amber: 2, green: 1 });
  });

  it("merges duplicates to the worst rating and weakest evidence, keeping every citation", () => {
    const r = rankIssues([
      {
        title: "Change of control — Globex",
        rating: "amber",
        category: "contract",
        documentRef: "MSA",
        clauseRef: "14.2",
        evidenceGrade: "A",
      },
      {
        title: "change of control: globex",
        rating: "amber",
        category: "contract",
        documentRef: "MSA",
        clauseRef: "14.2",
        evidenceGrade: "A",
      },
      {
        title: "Change of control — Globex",
        rating: "red",
        category: "contract",
        documentRef: "Side letter",
        clauseRef: "2",
        evidenceGrade: "B",
      },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.duplicatesMerged).toBe(2);
    expect(r.issues[0]).toMatchObject({
      rating: "red",
      evidenceGrade: "B",
      documentRef: "MSA; Side letter",
      clauseRef: "14.2; 2",
    });
  });

  it("an issue with no document is kept but graded U, and listed; a missing clause counts when one is required", () => {
    const r = rankIssues([
      { title: "Oral side deal", rating: "red", evidenceGrade: "A" },
    ]);
    expect(r.issues[0]).toMatchObject({ cited: false, evidenceGrade: "U" });
    expect(r.issues[0].notes.join(" ")).toMatch(/lowered to U/);
    expect(r.uncited).toEqual(["Oral side deal"]);
    const need = rankIssues(
      [{ title: "X", rating: "amber", documentRef: "d" }],
      { requireClause: true },
    );
    expect(need.uncited).toEqual(["X"]);
    expect(
      rankIssues([{ title: "X", rating: "amber", documentRef: "d" }]).uncited,
    ).toEqual([]);
  });

  it("keeps an exposure range only with a basis, both ends, non-negative and ordered", () => {
    const base = { rating: "amber" as const, documentRef: "d", clauseRef: "c" };
    const r = rankIssues([
      {
        ...base,
        title: "ok",
        rangeLow: 1,
        rangeHigh: 2,
        rangeBasis: "Open years x rate",
      },
      { ...base, title: "no basis", rangeLow: 1, rangeHigh: 2 },
      { ...base, title: "one end", rangeLow: 1, rangeBasis: "b" },
      {
        ...base,
        title: "reversed",
        rangeLow: 3,
        rangeHigh: 2,
        rangeBasis: "b",
      },
    ]);
    const by = Object.fromEntries(r.issues.map((i) => [i.title, i.range]));
    expect(by.ok).toEqual({ low: 1, high: 2, basis: "Open years x rate" });
    expect([by["no basis"], by["one end"], by.reversed]).toEqual([
      null,
      null,
      null,
    ]);
    expect(r.rangesDropped.sort()).toEqual(["no basis", "one end", "reversed"]);
  });

  it("an unrecognised rating is shown as amber with a note, and blank titles are skipped", () => {
    const r = rankIssues([
      { title: "Odd", rating: "purple" as never, documentRef: "d" },
      { title: "  ", rating: "red" },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].rating).toBe("amber");
    expect(r.issues[0].notes.join(" ")).toMatch(/No valid rating/);
  });
});

describe("documentGaps", () => {
  it("lists expected documents not received, matching on containment", () => {
    expect(
      documentGaps(
        ["material contracts", "ip register"],
        ["Material contracts folder"],
      ),
    ).toEqual(["ip register"]);
    expect(documentGaps(["a"], undefined)).toEqual(["a"]);
    expect(documentGaps(["a"], [])).toEqual(["a"]);
  });
});

describe("toRedFlagHandoff", () => {
  it("hands over red and amber issues that carry an impact; counts the rest instead of guessing", () => {
    const { issues } = rankIssues([
      {
        title: "Claim",
        rating: "red",
        documentRef: "d",
        clauseRef: "4",
        impact: "price",
      },
      { title: "No impact", rating: "amber", documentRef: "d" },
      { title: "Fine", rating: "green", documentRef: "d", impact: "100-day" },
    ]);
    const h = toRedFlagHandoff(issues, "legal");
    expect(h.findings).toEqual(
      [
        {
          title: "Claim",
          workstream: "legal",
          severity: "red",
          impact: "price",
          evidenceGrade: "U",
          sourceRef: "d, 4",
        },
      ].map((f) => ({ ...f, evidenceGrade: "U" })),
    );
    expect(h.needingImpact).toEqual(["No impact"]);
  });
});

import { keyPersonIssue } from "./dd-issues";

describe("keyPersonIssue", () => {
  it("rates a key person by retention risk and documented knowledge, and raises nothing for low or medium", () => {
    expect(
      keyPersonIssue(
        {
          role: "CTO",
          retentionRisk: "high",
          knowledgeDocumented: false,
          documentRef: "ORG.pdf",
        },
        "people",
      ),
    ).toMatchObject({
      rating: "red",
      category: "people",
      evidenceGrade: "B",
      title:
        "Key person dependency: CTO (retention risk high; knowledge not documented)",
    });
    expect(
      keyPersonIssue(
        { role: "Lead", retentionRisk: "high", knowledgeDocumented: true },
        "x",
      ),
    ).toMatchObject({ rating: "amber", evidenceGrade: "U", category: "x" });
    expect(
      keyPersonIssue({ role: "Ops", retentionRisk: "high" }, "x")?.title,
    ).toMatch(/documentation not confirmed/);
    expect(keyPersonIssue({ role: "DevOps" }, "x")).toMatchObject({
      rating: "amber",
      title: "Retention risk unconfirmed: DevOps",
    });
    expect(
      keyPersonIssue({ role: "QA", retentionRisk: "low" }, "x"),
    ).toBeNull();
    expect(
      keyPersonIssue({ role: "QA", retentionRisk: "medium" }, "x"),
    ).toBeNull();
    expect(keyPersonIssue({ role: "  " }, "x")).toBeNull();
  });
});
