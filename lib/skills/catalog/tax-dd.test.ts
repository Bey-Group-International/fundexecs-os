// Tests for the tax-dd core. Scenario, worked by hand:
//   UK 2022: accounts 1000 = computation 1000                       -> reconciled
//   UK 2023: accounts 1200 vs computation 1000, 50 explained         -> difference 200, unexplained 150 -> derived amber (cited)
//   DE 2023: open, no computation                                    -> derived amber, graded U
//   US 2021: not open; accounts 500 vs 480, 20 explained             -> reconciled, open = false
//   Losses: UK 5000 restricted (cited), DE 800 unknown, US 100 none  -> 2 derived (the "no" one is not an issue)
//   Supplied: a red transfer-pricing issue with a range and basis; a PE issue with a range but NO basis (dropped); a green VAT item
import { taxDd, type TaxDdInput } from "./tax-dd";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = {
  workspaceId: "org1",
  principalId: "p1",
  executive: "diligence",
};

const input: TaxDdInput = {
  dealName: "Acme",
  documentsReceived: [
    "Tax returns and computations (open years)",
    "Group structure chart",
  ],
  exposureTypesReviewed: ["transfer-pricing", "vat-sales-tax"],
  openYears: [
    { jurisdiction: "UK", years: [2022, 2023] },
    { jurisdiction: "DE", years: [2023] },
  ],
  reconciliations: [
    {
      jurisdiction: "UK",
      year: 2022,
      chargeInAccounts: 1000,
      chargePerComputation: 1000,
      documentRef: "TC-UK22.pdf",
    },
    {
      jurisdiction: "UK",
      year: 2023,
      chargeInAccounts: 1200,
      chargePerComputation: 1000,
      explained: 50,
      documentRef: "TC-UK23.pdf",
    },
    {
      jurisdiction: "US",
      year: 2021,
      chargeInAccounts: 500,
      chargePerComputation: 480,
      explained: 20,
      documentRef: "TC-US21.pdf",
    },
  ],
  losses: [
    {
      jurisdiction: "UK",
      amount: 5000,
      restrictionOnChangeOfControl: "yes",
      documentRef: "TC-UK23.pdf",
    },
    { jurisdiction: "DE", amount: 800 },
    { jurisdiction: "US", amount: 100, restrictionOnChangeOfControl: "no" },
  ],
  issues: [
    {
      title: "Intercompany service charge not at arm's length",
      rating: "red",
      category: "transfer-pricing",
      jurisdiction: "UK",
      period: "2022",
      documentRef: "TP-study.pdf",
      evidenceGrade: "A",
      impact: "price",
      rangeLow: 200,
      rangeHigh: 600,
      rangeBasis: "Mark-up gap x service charge x open years",
      question: "Is the mark-up defensible, and what is the likely adjustment?",
    },
    {
      title: "Possible permanent establishment from sales staff",
      rating: "amber",
      category: "permanent-establishment",
      jurisdiction: "FR",
      period: "2023",
      documentRef: "Org-chart.pdf",
      rangeLow: 100,
      rangeHigh: 300,
    },
    {
      title: "Export VAT evidence incomplete",
      rating: "green",
      category: "vat-sales-tax",
      jurisdiction: "UK",
      period: "2023",
      documentRef: "VAT-file.pdf",
    },
  ],
};
const run = (i: TaxDdInput) => taxDd.run(i, ctx);

describe("tax-dd core", () => {
  it("reconciles each year from the accounts to the computation, with the unexplained amount", () => {
    const y = run(input).structured.years;
    expect(y.map((r) => [r.jurisdiction, r.year, r.status, r.open])).toEqual([
      ["DE", 2023, "no-computation", true],
      ["UK", 2022, "reconciled", true],
      ["UK", 2023, "difference", true],
      ["US", 2021, "reconciled", false],
    ]);
    expect(y[2]).toMatchObject({
      chargeInAccounts: 1200,
      chargePerComputation: 1000,
      difference: 200,
      explained: 50,
      unexplained: 150,
    });
    expect(y[3]).toMatchObject({
      difference: 20,
      explained: 20,
      unexplained: 0,
    }); // fully explained
    expect(y[0]).toMatchObject({ chargeInAccounts: null, difference: null });
  });

  it("an open year with no computation is named and graded U, never assumed clean", () => {
    const r = run(input).structured;
    const i = r.issues.find(
      (x) => x.title === "Open year not reconciled: DE 2023",
    )!;
    expect(i).toMatchObject({
      rating: "amber",
      evidenceGrade: "U",
      cited: false,
      derived: true,
      jurisdiction: "DE",
      period: "2023",
    });
    expect(r.uncited).toContain("Open year not reconciled: DE 2023");
  });

  it("derives an issue for an unexplained difference, and for losses that are restricted or not confirmed (not for 'no')", () => {
    const titles = run(input).structured.issues.map((i) => i.title);
    expect(titles).toContain(
      "Unreconciled tax charge: UK 2023 — accounts 1200 vs computation 1000 (unexplained 150)",
    );
    expect(titles).toContain(
      "Loss utilisation after change of control: UK — losses of 5000 (restricted on a change of control)",
    );
    expect(titles).toContain(
      "Loss utilisation after change of control: DE — losses of 800 (restriction not confirmed)",
    );
    expect(titles.some((t) => /US/.test(t) && /Loss/.test(t))).toBe(false);
    expect(
      titles.some((t) => /UK 2022/.test(t) && /Unreconciled/.test(t)),
    ).toBe(false);
    expect(run(input).structured.derivedCount).toBe(4);
  });

  it("a tolerance treats small differences as reconciled; without one every difference is listed and labelled", () => {
    const loose = run({ ...input, toleranceAbs: 200 }).structured;
    expect(
      loose.years.find((y) => y.jurisdiction === "UK" && y.year === 2023)
        ?.status,
    ).toBe("reconciled");
    expect(loose.derivedCount).toBe(3);
    const strict = run(input);
    expect(
      strict.sources.some(
        (s) =>
          s.kind === "assumption" && /Reconciliation tolerance/.test(s.label),
      ),
    ).toBe(true);
  });

  it("an explanation larger than the difference is noted", () => {
    const r = run({
      ...input,
      reconciliations: [
        {
          jurisdiction: "UK",
          year: 2023,
          chargeInAccounts: 1010,
          chargePerComputation: 1000,
          explained: 40,
        },
      ],
    }).structured;
    expect(
      r.years.find((y) => y.year === 2023 && y.jurisdiction === "UK"),
    ).toMatchObject({ status: "reconciled", unexplained: 0 });
    expect(
      r.years.find((y) => y.year === 2023 && y.jurisdiction === "UK")?.note,
    ).toMatch(/larger than the difference/);
  });

  it("ranks red first, then amber by evidence strength, then green", () => {
    const r = run(input).structured;
    expect(r.counts).toEqual({ red: 1, amber: 5, green: 1 });
    expect(r.issues.map((i) => i.rating)).toEqual([
      "red",
      "amber",
      "amber",
      "amber",
      "amber",
      "amber",
      "green",
    ]);
    expect(r.issues[0].category).toBe("transfer-pricing");
    expect(r.issues.slice(1, 3).map((i) => i.evidenceGrade)).toEqual([
      "A",
      "A",
    ]);
    expect(r.issues[6].title).toBe("Export VAT evidence incomplete");
  });

  it("keeps a range only with a stated basis, and sums only the supported ranges without netting overlaps", () => {
    const r = run(input);
    const pe = r.structured.issues.find(
      (i) => i.category === "permanent-establishment",
    )!;
    expect(pe.range).toBeNull();
    expect(pe.notes.join(" ")).toMatch(/no basis is stated/);
    expect(r.structured.rangesDropped).toEqual([
      "Possible permanent establishment from sales staff",
    ]);
    expect(r.structured.rangeTotal).toEqual({
      low: 200,
      high: 600,
      issuesIncluded: 1,
      redAmberWithoutRange: 5,
    });
    expect(r.structured.note).toMatch(
      /sum to 200–600 across 1 issue; 5 red or amber issues have no range/,
    );
    expect(
      r.sources.some((s) => /Sum of supported exposure ranges/.test(s.label)),
    ).toBe(true);
    expect(run({ ...input, issues: [] }).structured.rangeTotal).toBeNull();
  });

  it("lists the adviser's questions, and flags red or amber issues that carry none", () => {
    const r = run(input);
    expect(r.structured.adviserQuestions).toHaveLength(5);
    expect(r.structured.adviserQuestions[0]).toMatchObject({
      issue: "Intercompany service charge not at arm's length",
      jurisdiction: "UK",
      period: "2022",
    });
    expect(r.missingData.join(" ")).toMatch(
      /1 red or amber issue carry no question/,
    );
  });

  it("lists missing documents and exposure types not reviewed", () => {
    const r = run(input);
    expect(r.structured.documentGaps).toEqual([
      "tax authority correspondence",
      "transfer pricing documentation",
    ]);
    expect(r.structured.typesNotReviewed).toEqual([
      "permanent-establishment",
      "payroll-tax",
      "unused-losses",
    ]);
    const none = run({});
    expect(none.structured.documentGaps).toHaveLength(4);
    expect(none.structured.typesNotReviewed).toHaveLength(5);
    expect(none.missingData.join(" ")).toMatch(/No open tax years supplied/);
    expect(none.structured.note).toMatch(/not a clean bill/);
  });

  it("de-duplicates the same exposure in the same jurisdiction and year, but not across years", () => {
    const base = {
      rating: "amber" as const,
      category: "payroll-tax" as const,
      jurisdiction: "UK",
      documentRef: "d",
    };
    const r = run({
      issues: [
        { ...base, title: "Contractor status", period: "2022" },
        { ...base, title: "contractor status", period: "2022", rating: "red" },
        { ...base, title: "Contractor status", period: "2023" },
      ],
    }).structured;
    expect(r.issues).toHaveLength(2);
    expect(r.duplicatesMerged).toBe(1);
    expect(r.issues[0]).toMatchObject({ rating: "red", period: "2022" });
  });

  it("hands red and amber issues with an impact to the red flag register", () => {
    const h = run(input).structured.handoff;
    expect(h.findings).toEqual([
      {
        title: "Intercompany service charge not at arm's length",
        workstream: "tax",
        severity: "red",
        impact: "price",
        evidenceGrade: "A",
        sourceRef: "TP-study.pdf",
      },
    ]);
    expect(h.needingImpact).toHaveLength(5);
  });

  it("is deterministic, validates against its schemas, states the limitation and names the tax adviser as the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(
      JSON.stringify(a.structured),
    );
    expect(validate(a.structured, taxDd.manifest.outputSchema).valid).toBe(
      true,
    );
    expect(validate(input, taxDd.manifest.inputSchema).valid).toBe(true);
    expect(validate({}, taxDd.manifest.inputSchema).valid).toBe(true);
    expect(a.structured.limitation).toMatch(/does not quantify or opine/);
    expect(a.structured.gate).toBe(
      "The tax adviser confirms each exposure before it moves into the price or SPA.",
    );
    expect(
      run({ ...input, gateOwner: "Jane Doe, tax partner" }).structured.gate,
    ).toBe(
      "Jane Doe, tax partner confirms each exposure before it moves into the price or SPA.",
    );
  });

  it("reads correctly when exactly one exposure is uncited", () => {
    const r = run({
      issues: [
        { title: "Payroll audit", rating: "amber", category: "payroll-tax" },
      ],
    });
    expect(r.missingData.join(" ")).toMatch(
      /1 exposure cites no document and is graded U: Payroll audit/,
    );
    expect(r.structured.note).toMatch(/1 cites no document\./);
  });
});
