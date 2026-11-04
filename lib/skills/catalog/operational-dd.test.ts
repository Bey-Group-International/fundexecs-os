// Tests for the operational-dd core. Scenario, worked by hand (revenue 1,000):
//   Cost map: Manufacturing 300 (30.0% vs 25 benchmark = +5.0 above), Sales & marketing 120 (12.0% vs 12 = in line),
//             G&A 80 (8.0% vs 10 = -2.0 below), IT 40 (4.0%, no benchmark); total 540; reported 560 -> difference -20, does not tie
//   Shares of the map: 300/540 = 55.6%, 120/540 = 22.2%, 80/540 = 14.8%, 40/540 = 7.4%
//   Capacity (plan's own volume): Plant A 1,200 vs 1,000 = 120.0% breach; Plant B 700 vs 1,000 = 70.0%; Warehouse has no plan volume
//   Suppliers (spend 1,000): Steelco 60.0% (critical, no alternative), Packwell 30.0%, Freight 10.0%
//   KPIs: OEE 60 -> 75 = +25.0% (>= 5% default materiality); scrap 4 -> 3.9 = -2.5% (not material); a zero base has no percent
//   Improvements in the plan: lean (evidenced, B, 20-30), procurement (untested, 40-60), packing (untested, saving has no basis -> dropped)
import { operationalDd, type OperationalDdInput } from "./operational-dd";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = {
  workspaceId: "org1",
  principalId: "p1",
  executive: "diligence",
};

const input: OperationalDdInput = {
  dealName: "Acme",
  documentsReceived: [
    "Org chart and headcount data",
    "Site and capacity data",
    "Supplier list and spend",
  ],
  categoriesReviewed: ["cost-base", "capacity"],
  revenue: 1000,
  costBase: [
    {
      function: "Manufacturing",
      cost: 300,
      benchmarkPctOfRevenue: 25,
      documentRef: "COST.xlsx",
    },
    { function: "Sales & marketing", cost: 120, benchmarkPctOfRevenue: 12 },
    { function: "G&A", cost: 80, benchmarkPctOfRevenue: 10 },
    { function: "IT", cost: 40 },
  ],
  reportedCostBase: 560,
  capacity: [
    {
      unit: "Plant A",
      metric: "units/yr",
      currentVolume: 800,
      capacity: 1000,
      planVolume: 1200,
      documentRef: "SITE.pdf",
    },
    { unit: "Plant B", currentVolume: 500, capacity: 1000, planVolume: 700 },
    { unit: "Warehouse", capacity: 500 },
  ],
  keyPeople: [
    {
      role: "Plant manager",
      retentionRisk: "high",
      knowledgeDocumented: false,
      documentRef: "ORG.pdf",
    },
    { role: "COO", retentionRisk: "low" },
  ],
  suppliers: [
    {
      name: "Steelco",
      spend: 600,
      critical: true,
      alternativeSupplier: "no",
      documentRef: "SUP.xlsx",
    },
    { name: "Packwell", spend: 300, alternativeSupplier: "yes" },
    { name: "Freight Ltd", spend: 100 },
  ],
  supplierConcentrationPct: 50,
  kpis: [
    { name: "OEE %", current: 60, plan: 75 },
    { name: "Scrap rate %", current: 4, plan: 3.9 },
    { name: "Zero base", current: 0, plan: 1 },
  ],
  improvements: [
    {
      name: "Lean line rebalancing",
      inPlan: true,
      savingLow: 20,
      savingHigh: 30,
      savingBasis: "Pilot at Plant B cut cost per unit by 6%",
      evidence: "Plant B pilot report",
      evidenceGrade: "B",
    },
    {
      name: "Procurement consolidation",
      inPlan: true,
      savingLow: 40,
      savingHigh: 60,
      savingBasis: "Management estimate",
    },
    { name: "Automate packing", inPlan: true, savingLow: 15, savingHigh: 25 },
    {
      name: "Shared service centre",
      inPlan: false,
      savingLow: 30,
      savingHigh: 50,
      savingBasis: "Benchmark study",
    },
  ],
  issues: [
    {
      title: "Single shift pattern limits output",
      rating: "amber",
      category: "capacity",
      documentRef: "SITE.pdf",
      evidenceGrade: "B",
    },
  ],
};
const run = (i: OperationalDdInput) => operationalDd.run(i, ctx);

describe("operational-dd core", () => {
  it("maps the cost base, expresses it against revenue and benchmarks, and ties it to the reported figure", () => {
    const m = run(input).structured.costMap;
    expect(m.total).toBe(540);
    expect(
      m.rows.map((r) => [
        r.function,
        r.pctOfTotal,
        r.pctOfRevenue,
        r.variancePts,
        r.vsBenchmark,
      ]),
    ).toEqual([
      ["Manufacturing", 55.6, 30, 5, "above"],
      ["Sales & marketing", 22.2, 12, 0, "in-line"],
      ["G&A", 14.8, 8, -2, "below"],
      ["IT", 7.4, 4, null, "no-benchmark"],
    ]);
    expect(m).toMatchObject({
      reportedCostBase: 560,
      difference: -20,
      tiesToReported: false,
      benchmarkToleranceIsDefault: true,
    });
    const r = run({ ...input, tieOutToleranceAbs: 25 }).structured.costMap;
    expect(r.tiesToReported).toBe(true);
  });

  it("flags a cost above benchmark and a map that does not tie; a tolerance on benchmarks treats small gaps as in line", () => {
    const titles = run(input).structured.issues.map((i) => i.title);
    expect(titles).toContain(
      "Cost above benchmark: Manufacturing at 30% of revenue vs 25% (5 points)",
    );
    expect(titles).toContain(
      "Cost map does not tie to the reported cost base (map 540 vs reported 560; difference -20)",
    );
    const loose = run({ ...input, benchmarkTolerancePts: 5 }).structured;
    expect(
      loose.costMap.rows.find((r) => r.function === "Manufacturing")
        ?.vsBenchmark,
    ).toBe("in-line");
    expect(loose.costMap.benchmarkToleranceIsDefault).toBe(false);
    expect(loose.issues.some((i) => /Cost above benchmark/.test(i.title))).toBe(
      false,
    );
  });

  it("without revenue, costs cannot be compared with benchmarks, and says so", () => {
    const r = run({ ...input, revenue: undefined });
    expect(r.structured.costMap.rows[0]).toMatchObject({
      pctOfRevenue: null,
      vsBenchmark: "no-revenue",
    });
    expect(r.missingData.join(" ")).toMatch(/No revenue supplied/);
  });

  it("tests capacity against the PLAN's own volume; a plan volume that is missing is flagged, never estimated", () => {
    const r = run(input);
    expect(r.structured.capacity).toEqual([
      {
        unit: "Plant A",
        metric: "units/yr",
        currentVolume: 800,
        capacity: 1000,
        planVolume: 1200,
        currentUtilisationPct: 80,
        planUtilisationPct: 120,
        status: "breach",
      },
      {
        unit: "Plant B",
        metric: null,
        currentVolume: 500,
        capacity: 1000,
        planVolume: 700,
        currentUtilisationPct: 50,
        planUtilisationPct: 70,
        status: "within",
      },
      {
        unit: "Warehouse",
        metric: null,
        currentVolume: null,
        capacity: 500,
        planVolume: null,
        currentUtilisationPct: null,
        planUtilisationPct: null,
        status: "plan-volume-missing",
      },
    ]);
    expect(r.missingData.join(" ")).toMatch(
      /Capacity test "Warehouse" has no plan volume/,
    );
    expect(r.structured.issues.map((i) => i.title)).toContain(
      "Capacity breached by the plan: Plant A (plan 1200 vs capacity 1000 units/yr)",
    );
    expect(
      run({ ...input, warnAbovePct: 65 }).structured.capacity[1].status,
    ).toBe("warn");
    expect(
      run({
        ...input,
        capacity: [{ unit: "Bad", capacity: 0, planVolume: 1 }],
      }).missingData.join(" "),
    ).toMatch(/needs a capacity above zero/);
  });

  it("reports supplier shares, and flags a critical supplier with no alternative and (only with a limit) concentration", () => {
    const r = run(input).structured;
    expect(r.suppliers.totalSpend).toBe(1000);
    expect(r.suppliers.topSharePct).toBe(60);
    expect(r.suppliers.rows.map((s) => [s.name, s.sharePct])).toEqual([
      ["Steelco", 60],
      ["Packwell", 30],
      ["Freight Ltd", 10],
    ]);
    const titles = r.issues.map((i) => i.title);
    expect(titles).toContain(
      "Critical supplier with no confirmed alternative: Steelco (60% of listed spend; alternative none)",
    );
    expect(titles).toContain(
      "Supplier concentration: Steelco is 60% of listed spend (limit 50%)",
    );
    expect(
      r.issues.find((i) => i.title.startsWith("Critical supplier"))?.rating,
    ).toBe("red");
    const noLimit = run({
      ...input,
      supplierConcentrationPct: undefined,
    }).structured;
    expect(
      noLimit.issues.some((i) => /Supplier concentration/.test(i.title)),
    ).toBe(false);
    expect(noLimit.suppliers.topSharePct).toBe(60);
    const unconfirmed = run({
      suppliers: [{ name: "X", spend: 10, critical: true }],
    }).structured.issues[0];
    expect(unconfirmed).toMatchObject({
      rating: "amber",
      title:
        "Critical supplier with no confirmed alternative: X (100% of listed spend; alternative not confirmed)",
    });
  });

  it("rates key people by the shared rule", () => {
    const people = run(input).structured.issues.filter(
      (i) => i.category === "people",
    );
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      rating: "red",
      title:
        "Key person dependency: Plant manager (retention risk high; knowledge not documented)",
    });
  });

  it("sets the plan's KPI moves against the firm's materiality (default labelled), and cannot express a move from zero", () => {
    const r = run(input);
    expect(r.structured.kpis).toMatchObject({
      materialityPct: 5,
      policyIsDefault: true,
    });
    expect(r.structured.kpis.rows).toEqual([
      { name: "OEE %", current: 60, plan: 75, changePct: 25, material: true },
      {
        name: "Scrap rate %",
        current: 4,
        plan: 3.9,
        changePct: -2.5,
        material: false,
      },
      {
        name: "Zero base",
        current: 0,
        plan: 1,
        changePct: null,
        material: false,
      },
    ]);
    expect(r.structured.issues.map((i) => i.title)).toContain(
      "Plan assumes a material change in OEE %: 60 to 75 (25%)",
    );
    expect(r.missingData.join(" ")).toMatch(
      /KPI "Zero base": the current value is zero/,
    );
    expect(
      r.sources.some(
        (s) => s.kind === "assumption" && /KPI materiality/.test(s.label),
      ),
    ).toBe(true);
    const firm = run({
      ...input,
      kpiPolicy: { materialityPct: 30 },
    }).structured;
    expect(firm.kpis).toMatchObject({
      materialityPct: 30,
      policyIsDefault: false,
    });
    expect(firm.kpis.rows[0].material).toBe(false);
  });

  it("marks every improvement evidenced or untested; an untested one in the plan is flagged", () => {
    const r = run(input).structured;
    expect(
      r.improvements.map((i) => [
        i.name,
        i.status,
        i.evidenceGrade,
        i.canSupportPrice,
      ]),
    ).toEqual([
      ["Lean line rebalancing", "evidenced", "B", true],
      ["Procurement consolidation", "untested", "U", false],
      ["Automate packing", "untested", "U", false],
      ["Shared service centre", "untested", "U", false],
    ]);
    const titles = r.issues.map((i) => i.title);
    expect(titles).toContain(
      "Plan relies on an untested improvement: Procurement consolidation (saving 40–60)",
    );
    expect(titles).toContain(
      "Plan relies on an untested improvement: Automate packing",
    );
    // outside the plan: not flagged as the plan's reliance
    expect(titles.some((t) => /Shared service centre/.test(t))).toBe(false);
  });

  it("splits the plan's savings by evidence, drops a saving with no basis, and never adds improvements outside the plan", () => {
    const r = run(input);
    expect(
      r.structured.improvements.find((i) => i.name === "Automate packing"),
    ).toMatchObject({ saving: null });
    expect(
      r.structured.improvements.find((i) => i.name === "Automate packing")
        ?.savingDropped,
    ).toMatch(/no basis is stated/);
    expect(r.structured.planSavings).toEqual({
      evidenced: { low: 20, high: 30, count: 1 },
      untested: { low: 40, high: 60, count: 1 },
      priceSupported: { low: 20, high: 30, count: 1 },
    });
    expect(r.structured.outsidePlan).toEqual([
      {
        name: "Shared service centre",
        saving: { low: 30, high: 50, basis: "Benchmark study" },
      },
    ]);
    expect(r.missingData.join(" ")).toMatch(
      /Automate packing: saving ignored — no basis is stated/,
    );
    // a firm policy that lets grade C support a price does not make an untested (U) improvement count
    const firm = run({
      ...input,
      evidencePolicy: { supportsPrice: { C: true } },
    }).structured;
    expect(firm.planSavings.priceSupported).toEqual({
      low: 20,
      high: 30,
      count: 1,
    });
    const strict = run({
      ...input,
      evidencePolicy: { supportsPrice: { A: true, B: false } },
    }).structured;
    expect(strict.planSavings.priceSupported).toBeNull();
    expect(strict.evidencePolicyIsDefault).toBe(false);
  });

  it("ranks 10 issues red first and counts them", () => {
    const r = run(input).structured;
    expect(r.issues).toHaveLength(10);
    expect(r.derivedCount).toBe(9);
    expect(r.counts).toEqual({ red: 3, amber: 7, green: 0 });
    expect(r.issues.slice(0, 3).map((i) => i.title)).toEqual([
      "Capacity breached by the plan: Plant A (plan 1200 vs capacity 1000 units/yr)",
      "Key person dependency: Plant manager (retention risk high; knowledge not documented)",
      "Critical supplier with no confirmed alternative: Steelco (60% of listed spend; alternative none)",
    ]);
  });

  it("lists uncited issues, missing documents and categories not reviewed", () => {
    const r = run(input);
    expect(r.structured.uncited.sort()).toEqual([
      "Cost map does not tie to the reported cost base (map 540 vs reported 560; difference -20)",
      "Plan assumes a material change in OEE %: 60 to 75 (25%)",
      "Plan relies on an untested improvement: Automate packing",
      "Plan relies on an untested improvement: Procurement consolidation (saving 40–60)",
    ]);
    expect(r.structured.documentGaps).toEqual(["operating kpis"]);
    expect(r.structured.categoriesNotReviewed).toEqual([
      "people",
      "suppliers",
      "improvements",
    ]);
    const none = run({});
    expect(none.structured.documentGaps).toHaveLength(4);
    expect(none.structured.categoriesNotReviewed).toHaveLength(5);
    expect(none.structured.note).toMatch(/not a clean bill/);
    expect(none.missingData.join(" ")).toMatch(/No cost base supplied/);
    expect(none.missingData.join(" ")).toMatch(/No improvements supplied/);
  });

  it("states it is desk-based and asks for a site visit before IC, until one is recorded", () => {
    const a = run(input);
    expect(a.structured.basisOfReview).toBe(
      "Desk-based review only: no site visit.",
    );
    expect(a.structured.limitation).toMatch(/Pair this with a visit before IC/);
    expect(a.missingData.join(" ")).toMatch(/No site visit recorded/);
    const b = run({ ...input, siteVisitDone: true });
    expect(b.structured.basisOfReview).toBe(
      "Document review plus a site visit.",
    );
    expect(b.missingData.join(" ")).not.toMatch(/No site visit recorded/);
  });

  it("hands red and amber issues with an impact to the red flag register", () => {
    const h = run({
      ...input,
      issues: [
        {
          title: "Plant A at its limit",
          rating: "red",
          category: "capacity",
          documentRef: "SITE.pdf",
          evidenceGrade: "A",
          impact: "100-day",
        },
      ],
    }).structured.handoff;
    expect(h.findings).toEqual([
      {
        title: "Plant A at its limit",
        workstream: "operational",
        severity: "red",
        impact: "100-day",
        evidenceGrade: "A",
        sourceRef: "SITE.pdf",
      },
    ]);
    expect(h.needingImpact.length).toBeGreaterThan(5);
  });

  it("is deterministic, validates against its schemas and names the operating partner as the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(
      JSON.stringify(a.structured),
    );
    expect(
      validate(a.structured, operationalDd.manifest.outputSchema).valid,
    ).toBe(true);
    expect(validate(input, operationalDd.manifest.inputSchema).valid).toBe(
      true,
    );
    expect(validate({}, operationalDd.manifest.inputSchema).valid).toBe(true);
    expect(
      validate(run({}).structured, operationalDd.manifest.outputSchema).valid,
    ).toBe(true);
    expect(a.structured.gate).toBe(
      "The operating partner signs the improvement register.",
    );
    expect(
      run({ ...input, gateOwner: "Jane Doe, operating partner" }).structured
        .gate,
    ).toBe("Jane Doe, operating partner signs the improvement register.");
  });

  it("reads correctly when exactly one risk is uncited", () => {
    expect(
      run({
        issues: [{ title: "Aging line 3", rating: "amber" }],
      }).missingData.join(" "),
    ).toMatch(/1 risk cites no document and is graded U: Aging line 3/);
  });
});
