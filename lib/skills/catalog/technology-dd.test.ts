// Tests for the technology-dd core. Scenario, worked by hand:
//   Pen test 2025-09-15, as of 2026-11-04: (2026-2025)*12 + (11-9) - 1 (the 4th is before the 15th) = 13 months > 12 -> stale
//   Findings: high+open -> red; low -> green; medium+accepted -> amber; high+remediated -> green
//   Capacity: 600 orders/min x (1 + 80%) = 1,080 vs 1,000 -> 108.0% breach (red); 4 TB x 1.5 = 6 vs 10 -> 60.0% within
//   People: CTO high + undocumented -> red; architect high + documented -> amber; DevOps unknown -> amber; QA low -> none
//   Ranges with a basis: SQL injection 30-50 (grade A) + monolith 200-400 (grade B) = 230-450
import { technologyDd, type TechnologyDdInput } from "./technology-dd";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = {
  workspaceId: "org1",
  principalId: "p1",
  executive: "diligence",
};

const input: TechnologyDdInput = {
  dealName: "Acme",
  documentsReceived: [
    "Architecture documents",
    "Security policies and pen test reports",
    "Product roadmap",
  ],
  categoriesReviewed: ["security", "infrastructure"],
  hosting: "AWS eu-west-1",
  components: [
    {
      name: "Core API",
      kind: "service",
      version: "Node 14",
      supportStatus: "end-of-life",
      documentRef: "ARCH.pdf",
    },
    {
      name: "Billing DB",
      version: "Postgres 15",
      supportStatus: "supported",
      documentRef: "ARCH.pdf",
    },
    { name: "Legacy ETL" },
  ],
  asOf: "2026-11-04",
  penTest: { date: "2025-09-15", documentRef: "PT-2025.pdf" },
  securityFindings: [
    {
      title: "SQL injection in search endpoint",
      severity: "high",
      status: "open",
      documentRef: "PT-2025.pdf §4.2",
      remediation: {
        low: 30,
        high: 50,
        basis: "2-3 engineer-weeks at 1,500 a day",
      },
    },
    {
      title: "Missing HSTS header",
      severity: "low",
      status: "open",
      documentRef: "PT-2025.pdf §6.1",
    },
    {
      title: "Weak password policy",
      severity: "medium",
      status: "accepted",
      documentRef: "PT-2025.pdf §5.3",
    },
    {
      title: "Outdated TLS configuration",
      severity: "high",
      status: "remediated",
      documentRef: "PT-2025.pdf §4.9",
    },
  ],
  capacityTests: [
    {
      metric: "Peak orders/min",
      currentPeak: 600,
      capacity: 1000,
      planGrowthPct: 80,
      documentRef: "LOAD.pdf",
    },
    {
      metric: "DB storage TB",
      currentPeak: 4,
      capacity: 10,
      planGrowthPct: 50,
    },
  ],
  keyPeople: [
    {
      role: "CTO",
      retentionRisk: "high",
      knowledgeDocumented: false,
      documentRef: "ORG.pdf",
    },
    {
      role: "Lead architect",
      retentionRisk: "high",
      knowledgeDocumented: true,
    },
    { role: "DevOps lead" },
    { role: "QA lead", retentionRisk: "low" },
  ],
  issues: [
    {
      title: "Monolith blocks independent scaling",
      rating: "amber",
      category: "technical-debt",
      documentRef: "ARCH.pdf",
      evidenceGrade: "B",
      rangeLow: 200,
      rangeHigh: 400,
      rangeBasis: "Vendor quote for the service split plus 20% contingency",
      question: "Is the split needed within the hold?",
    },
    {
      title: "Test coverage unknown",
      rating: "amber",
      category: "technical-debt",
      documentRef: "x",
      rangeLow: 50,
      rangeHigh: 80,
    },
  ],
};
const run = (i: TechnologyDdInput) => technologyDd.run(i, ctx);

describe("technology-dd core", () => {
  it("describes the stack as supplied and names end-of-life components and unstated support status", () => {
    const r = run(input);
    expect(r.structured.stack.hosting).toBe("AWS eu-west-1");
    expect(r.structured.stack.components).toHaveLength(3);
    expect(r.structured.stack.supportUnknown).toEqual(["Legacy ETL"]);
    expect(r.missingData.join(" ")).toMatch(
      /Support status not stated for: Legacy ETL/,
    );
    const eol = r.structured.issues.find(
      (i) => i.title === "End-of-life component: Core API Node 14",
    )!;
    expect(eol).toMatchObject({
      rating: "amber",
      category: "infrastructure",
      evidenceGrade: "A",
      cited: true,
      derived: true,
    });
    expect(run({}).missingData.join(" ")).toMatch(/No stack described/);
  });

  it("ages the pen test in whole months and flags it past the limit, labelling the default limit", () => {
    const r = run(input);
    expect(r.structured.penTest).toMatchObject({
      status: "stale",
      ageMonths: 13,
      maxAgeMonths: 12,
      maxAgeIsDefault: true,
    });
    expect(r.structured.issues.map((i) => i.title)).toContain(
      "Penetration test is 13 months old (limit 12)",
    );
    expect(
      r.sources.some(
        (s) => s.kind === "assumption" && /Pen test maximum age/.test(s.label),
      ),
    ).toBe(true);
    const ok = run({ ...input, penTestMaxAgeMonths: 24 }).structured;
    expect(ok.penTest).toMatchObject({
      status: "current",
      ageMonths: 13,
      maxAgeMonths: 24,
      maxAgeIsDefault: false,
    });
    // one day short of 13 months is 12 whole months
    expect(
      run({ ...input, asOf: "2026-10-14" }).structured.penTest,
    ).toMatchObject({ status: "current", ageMonths: 12 });
  });

  it("flags a missing pen test, and does not age one it cannot date or has no as-of date for", () => {
    const none = run({ ...input, penTest: undefined }).structured;
    expect(none.penTest.status).toBe("none");
    expect(
      none.issues.find((i) => i.title === "No penetration test report seen"),
    ).toMatchObject({ rating: "amber", evidenceGrade: "U", cited: false });
    const noAsOf = run({ ...input, asOf: undefined });
    expect(noAsOf.structured.penTest).toMatchObject({
      status: "age-unknown",
      ageMonths: null,
    });
    expect(noAsOf.missingData.join(" ")).toMatch(/No as-of date supplied/);
    const badDate = run({
      ...input,
      penTest: { date: "Sept 2025", documentRef: "PT.pdf" },
    });
    expect(badDate.missingData.join(" ")).toMatch(
      /not a valid YYYY-MM-DD date/,
    );
  });

  it("rates security findings by severity and status, and says so in the title", () => {
    const by = Object.fromEntries(
      run(input)
        .structured.issues.filter(
          (i) => i.category === "security" && i.title.startsWith("Security:"),
        )
        .map((i) => [i.title, i.rating]),
    );
    expect(by).toEqual({
      "Security: SQL injection in search endpoint": "red",
      "Security: Missing HSTS header": "green",
      "Security: Weak password policy (risk accepted by management)": "amber",
      "Security: Outdated TLS configuration (remediated)": "green",
    });
    const unknown = run({
      securityFindings: [
        { title: "Open redirect", severity: "critical", documentRef: "PT.pdf" },
      ],
    }).structured.issues[0];
    expect(unknown).toMatchObject({
      title: "Security: Open redirect (status not stated; treated as open)",
      rating: "red",
    });
  });

  it("tests capacity against the plan's own growth: breach is red, and 'tight' needs a threshold the caller supplies", () => {
    const r = run(input).structured;
    expect(r.capacity).toEqual([
      {
        metric: "Peak orders/min",
        currentPeak: 600,
        capacity: 1000,
        planGrowthPct: 80,
        projected: 1080,
        utilisationPct: 108,
        status: "breach",
      },
      {
        metric: "DB storage TB",
        currentPeak: 4,
        capacity: 10,
        planGrowthPct: 50,
        projected: 6,
        utilisationPct: 60,
        status: "within",
      },
    ]);
    expect(
      r.issues.find((i) => i.title.startsWith("Capacity breached")),
    ).toMatchObject({
      rating: "red",
      category: "scalability",
      title:
        "Capacity breached under the plan: Peak orders/min (projected 1080 vs capacity 1000)",
    });
    expect(r.issues.some((i) => /DB storage/.test(i.title))).toBe(false);
    const warn = run({ ...input, warnAbovePct: 50 }).structured;
    expect(warn.capacity[1].status).toBe("warn");
    expect(warn.issues.find((i) => /DB storage/.test(i.title))).toMatchObject({
      rating: "amber",
      title:
        "Capacity tight under the plan: DB storage TB (projected 6 vs capacity 10)",
    });
    const bad = run({
      ...input,
      capacityTests: [
        { metric: "Broken", currentPeak: 1, capacity: 0, planGrowthPct: 10 },
      ],
    });
    expect(bad.structured.capacity).toEqual([]);
    expect(bad.missingData.join(" ")).toMatch(/Capacity test "Broken" needs/);
  });

  it("rates key people by retention risk and whether the knowledge is documented", () => {
    const r = run(input).structured;
    const by = Object.fromEntries(
      r.issues
        .filter((i) => i.category === "people")
        .map((i) => [i.title, [i.rating, i.evidenceGrade]]),
    );
    expect(by).toEqual({
      "Key person dependency: CTO (retention risk high; knowledge not documented)":
        ["red", "B"],
      "Key person dependency: Lead architect (retention risk high; knowledge documented)":
        ["amber", "U"],
      "Retention risk unconfirmed: DevOps lead": ["amber", "U"],
    });
  });

  it("ranks 12 risks: red first, then amber, then green, with counts", () => {
    const r = run(input).structured;
    expect(r.issues).toHaveLength(12);
    expect(r.derivedCount).toBe(10);
    expect(r.counts).toEqual({ red: 3, amber: 7, green: 2 });
    expect(r.issues.slice(0, 3).map((i) => i.title)).toEqual([
      "Security: SQL injection in search endpoint",
      "Key person dependency: CTO (retention risk high; knowledge not documented)",
      "Capacity breached under the plan: Peak orders/min (projected 1080 vs capacity 1000)",
    ]);
    expect(r.issues.slice(-2).every((i) => i.rating === "green")).toBe(true);
  });

  it("keeps a cost range only with a basis; sums them; and states the part that can support a price", () => {
    const r = run(input);
    expect(r.structured.rangesDropped).toEqual(["Test coverage unknown"]);
    expect(r.structured.rangeTotal).toEqual({
      low: 230,
      high: 450,
      issuesIncluded: 2,
    });
    expect(r.structured.priceSupportedRange).toEqual({
      low: 230,
      high: 450,
      issuesIncluded: 2,
      excludedForEvidence: 0,
    });
    expect(r.structured.evidencePolicyIsDefault).toBe(true);
    expect(r.structured.note).toMatch(
      /sum to 230–450; 2 of 2 can support a price \(default evidence policy\)/,
    );
  });

  it("excludes a cost range whose evidence grade the policy does not let support a price", () => {
    const weak = {
      title: "Legacy batch jobs",
      rating: "amber" as const,
      category: "technical-debt" as const,
      documentRef: "d",
      evidenceGrade: "C" as const,
      rangeLow: 10,
      rangeHigh: 20,
      rangeBasis: "Management estimate",
    };
    const def = run({
      ...input,
      issues: [...(input.issues ?? []), weak],
    }).structured;
    expect(def.rangeTotal).toEqual({ low: 240, high: 470, issuesIncluded: 3 });
    expect(def.priceSupportedRange).toEqual({
      low: 230,
      high: 450,
      issuesIncluded: 2,
      excludedForEvidence: 1,
    });
    const firm = run({
      ...input,
      issues: [...(input.issues ?? []), weak],
      evidencePolicy: { supportsPrice: { C: true } },
    }).structured;
    expect(firm.evidencePolicyIsDefault).toBe(false);
    expect(firm.priceSupportedRange).toEqual({
      low: 240,
      high: 470,
      issuesIncluded: 3,
      excludedForEvidence: 0,
    });
    expect(
      run({ ...input, issues: [], securityFindings: [] }).structured.rangeTotal,
    ).toBeNull();
  });

  it("lists uncited risks, missing documents and categories not reviewed", () => {
    const r = run(input);
    expect(r.structured.uncited.sort()).toEqual([
      "Key person dependency: Lead architect (retention risk high; knowledge documented)",
      "Retention risk unconfirmed: DevOps lead",
    ]);
    expect(r.structured.documentGaps).toEqual(["it spend and team structure"]);
    expect(r.structured.categoriesNotReviewed).toEqual([
      "technical-debt",
      "scalability",
      "people",
    ]);
    const none = run({});
    expect(none.structured.documentGaps).toHaveLength(4);
    expect(none.structured.categoriesNotReviewed).toHaveLength(5);
    // An empty review still raises the missing pen test, and says so.
    expect(none.structured.counts).toEqual({ red: 0, amber: 1, green: 0 });
    expect(none.structured.note).toMatch(/No pen test report seen/);
  });

  it("states the basis of review: document review only, and that repository access is not read", () => {
    expect(run(input).structured.basisOfReview).toBe(
      "Document review only: no repository access.",
    );
    expect(
      run({ ...input, repositoryAccess: true }).structured.basisOfReview,
    ).toMatch(/does not read code/);
    expect(run(input).structured.limitation).toMatch(
      /will not find what a code audit finds/,
    );
  });

  it("hands red and amber risks with an impact to the red flag register", () => {
    const h = run({
      ...input,
      issues: [
        {
          title: "Replatform needed",
          rating: "red",
          category: "technical-debt",
          documentRef: "ARCH.pdf",
          evidenceGrade: "A",
          impact: "price",
        },
      ],
    }).structured.handoff;
    expect(h.findings).toEqual([
      {
        title: "Replatform needed",
        workstream: "technology",
        severity: "red",
        impact: "price",
        evidenceGrade: "A",
        sourceRef: "ARCH.pdf",
      },
    ]);
    expect(h.needingImpact.length).toBeGreaterThan(5);
  });

  it("is deterministic, validates against its schemas and names a technical reviewer as the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(
      JSON.stringify(a.structured),
    );
    expect(
      validate(a.structured, technologyDd.manifest.outputSchema).valid,
    ).toBe(true);
    expect(validate(input, technologyDd.manifest.inputSchema).valid).toBe(true);
    expect(validate({}, technologyDd.manifest.inputSchema).valid).toBe(true);
    expect(
      validate(run({}).structured, technologyDd.manifest.outputSchema).valid,
    ).toBe(true);
    expect(a.structured.gate).toBe(
      "A technical reviewer confirms the risk ratings.",
    );
    expect(
      run({ ...input, gateOwner: "Jane Doe, CTO advisor" }).structured.gate,
    ).toBe("Jane Doe, CTO advisor confirms the risk ratings.");
  });
});
