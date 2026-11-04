// Golden tests for the PE-department diligence + valuation skills.
import { qoeBridge } from "./qoe-bridge";
import { revenueQuality } from "./revenue-quality";
import { redFlagRegister } from "./red-flag-register";
import { bidRange } from "./bid-range";
import { lbo } from "./lbo";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "diligence" };

describe("qoe-bridge", () => {
  const base = {
    reportedEbitda: 10,
    auditedEbitda: 10,
    managementAdjustedEbitda: 13,
    managementAdjustments: [
      { label: "Owner salary", amount: 1.5, status: "accepted" as const, support: "TB 2024 acct 6010" },
      { label: "Pro-forma synergies", amount: 1, status: "accepted" as const },
      { label: "One-off legal", amount: 0.5, status: "rejected" as const, support: "Invoice log" },
    ],
    diligenceAdjustments: [{ label: "Related-party rent below market", amount: -0.8, support: "Lease vs broker letter" }, { label: "Capitalised dev cost", amount: -0.4 }],
  };

  it("counts only supported adjustments and downgrades an accepted call with no support", () => {
    const r = qoeBridge.run(base, ctx);
    const rows = r.structured.rows;
    expect(rows.find((x) => x.label === "Pro-forma synergies")?.status).toBe("unsupported");
    expect(rows.find((x) => x.label === "Pro-forma synergies")?.inAdjustedEbitda).toBe(false);
    // 10 + 1.5 (accepted) - 0.8 (supported diligence) = 10.7 ; rejected, unsupported and unsupported diligence do not count
    expect(r.structured.diligenceAdjustedEbitda).toBe(10.7);
    expect(r.structured.deltaVsManagement).toBe(-2.3);
    expect(r.structured.managementBridgeCheck?.reconciles).toBe(true);
    expect(r.structured.addbacksNotAccepted).toBe(1.5);
    expect(r.structured.icMemoReady).toBe(false);
    expect(r.sources.find((s) => s.label === "Diligence-adjusted EBITDA")?.kind).toBe("calculation");
    expect(validate(r.structured, qoeBridge.manifest.outputSchema).valid).toBe(true);
  });

  it("flags an audited-EBITDA tie difference and a missing audit figure", () => {
    expect(qoeBridge.run({ ...base, auditedEbitda: 9.4 }, ctx).structured.auditedTie).toEqual({ auditedEbitda: 9.4, difference: 0.6, ties: false });
    expect(qoeBridge.run({ reportedEbitda: 5 }, ctx).missingData[0]).toMatch(/Audited EBITDA/);
  });

  it("treats an unreviewed adjustment as unsupported", () => {
    const r = qoeBridge.run({ reportedEbitda: 10, managementAdjustments: [{ label: "x", amount: 2 }] }, ctx);
    expect(r.structured.diligenceAdjustedEbitda).toBe(10);
  });
});

describe("revenue-quality", () => {
  const input = {
    years: ["2023", "2024"],
    reportedRevenue: { "2023": 100, "2024": 120 },
    customers: [
      { name: "BigCo A", relatedGroup: "BigCo", revenueByYear: { "2023": 30, "2024": 25 }, revenueClass: "contracted-recurring" as const, changeOfControl: "yes" as const, contractEnd: "2026-03" },
      { name: "BigCo B", relatedGroup: "BigCo", revenueByYear: { "2023": 10, "2024": 15 }, revenueClass: "contracted-recurring" as const },
      { name: "Mid", revenueByYear: { "2023": 40, "2024": 50 }, revenueClass: "repeat" as const, changeOfControl: "no" as const },
      { name: "Small", revenueByYear: { "2023": 20, "2024": 30 } },
    ],
  };

  it("merges related customers, ties to reported revenue, computes retention and flags unknown change-of-control", () => {
    const r = revenueQuality.run(input, ctx);
    const y24 = r.structured.byYear[1];
    expect(y24.ties).toBe(true);
    expect(y24.top1Pct).toBe(41.7); // BigCo group 40 / 120 beats Mid 50? Mid=50 -> 41.7
    expect(r.structured.retention?.netRevenueRetentionPct).toBe(120);
    expect(r.structured.retention?.grossRevenueRetentionPct).toBeLessThan(120);
    const big = r.structured.keyCustomers.find((k) => k.name === "BigCo");
    expect(big?.changeOfControl).toBe("yes");
    expect(r.structured.latestClassSplit.unclassifiedPct).toBe(25);
    expect(r.sources.find((s) => s.label.startsWith("Net revenue retention"))?.kind).toBe("calculation");
    expect(validate(r.structured, revenueQuality.manifest.outputSchema).valid).toBe(true);
  });

  it("keeps change-of-control unknown when it is unconfirmed, and reports a tie break", () => {
    const r = revenueQuality.run({ ...input, reportedRevenue: { "2023": 100, "2024": 200 } }, ctx);
    expect(r.structured.byYear[1].ties).toBe(false);
    expect(r.structured.keyCustomers.find((k) => k.name === "Small")?.changeOfControl).toBe("unknown");
    expect(r.structured.keyCustomers.find((k) => k.name === "Small")?.churnNote).toMatch(/not confirmed/);
  });
});

describe("red-flag-register", () => {
  const findings = [
    { title: "Customer concentration: top client 42%", workstream: "revenue-quality", severity: "amber" as const, impact: "price" as const, evidenceGrade: "A" as const, priceImpact: 5, treatment: "Earn-out", sourceRef: "RQ p.3" },
    { title: "customer concentration top client 42", workstream: "commercial", severity: "red" as const, impact: "structure" as const, evidenceGrade: "B" as const },
    { title: "Undisclosed tax audit", workstream: "tax", severity: "red" as const, impact: "walk-away" as const },
    { title: "Churn spike claimed by ex-employee", workstream: "commercial", severity: "amber" as const, impact: "price" as const, evidenceGrade: "C" as const, priceImpact: 3 },
  ];

  it("merges duplicates at worst case, ranks by impact, and keeps weak-evidence price claims out of the adjustment", () => {
    const r = redFlagRegister.run({ findings, workstreamsRun: ["commercial", "tax", "revenue-quality"] }, ctx);
    const reg = r.structured.register;
    expect(r.structured.duplicatesMerged).toBe(1);
    expect(reg[0].title).toBe("Undisclosed tax audit");
    expect(reg[0].untested).toBe(true); // no grade given -> U
    const conc = reg.find((e) => e.title.startsWith("Customer concentration"));
    expect(conc?.severity).toBe("red");
    expect(conc?.impact).toBe("price");
    expect(conc?.workstreams).toEqual(["commercial", "revenue-quality"]);
    expect(conc?.evidenceGrade).toBe("B"); // weakest of A and B
    expect(r.structured.supportedPriceAdjustment).toBe(5);
    expect(r.structured.unsupportedPriceClaims).toEqual([{ title: "Churn spike claimed by ex-employee", priceImpact: 3, evidenceGrade: "C" }]);
    expect(r.structured.blindSpots).toEqual(["financial", "legal", "operational", "technology"]);
    expect(r.structured.challenges.join(" ")).toMatch(/walk-away decision but rests on grade U/);
    expect(validate(r.structured, redFlagRegister.manifest.outputSchema).valid).toBe(true);
  });
});

describe("bid-range", () => {
  const input = {
    ebitda: 10,
    leverageMultiple: 4,
    holdYears: 5,
    ebitdaGrowthRate: 0.08,
    exitMultiple: 9,
    hurdles: { base: { irr: 0.2 }, downside: { irr: 0.1 }, holdYears: 5 },
    downsideCase: { ebitdaGrowthRate: 0, exitMultiple: 8 },
    compsMultipleRange: { low: 8, high: 11 },
  };
  const analyst: SkillContext = { ...ctx, executive: "analyst" };

  it("solves the max price from the lbo core and the walk-away actually clears both hurdles", () => {
    const r = bidRange.run(input, analyst);
    const s = r.structured;
    expect(s.base.maxEntryMultiple).not.toBeNull();
    expect(s.downside?.maxEntryMultiple).not.toBeNull();
    // Re-run the lbo core at the max base multiple: IRR must sit at/above 20%, and just above it must miss.
    const at = (m: number) => lbo.run({ entryEbitda: 10, entryMultiple: m, leverageMultiple: 4, holdYears: 5, exitMultiple: 9, ebitdaGrowthRate: 0.08 }, analyst).structured.irr as number;
    expect(at(s.base.maxEntryMultiple as number)).toBeGreaterThanOrEqual(0.2 - 1e-4);
    expect(at((s.base.maxEntryMultiple as number) + 0.1)).toBeLessThan(0.2);
    expect(s.walkAwayClearsBase).toBe("clears");
    expect(s.walkAwayClearsDownside).toBe("clears");
    expect(s.walkAway.ev).toBeLessThanOrEqual(Math.min(s.base.maxEntryEV as number, s.downside?.maxEntryEV as number));
    expect(s.hurdlesAreDefault).toBe(false);
    expect(validate(s, bidRange.manifest.outputSchema).valid).toBe(true);
  });

  it("subtracts supported red-flag adjustments, and never invents opening / target", () => {
    const a = bidRange.run(input, analyst).structured;
    const b = bidRange.run({ ...input, redFlagPriceAdjustment: 5 }, analyst).structured;
    expect((a.walkAway.ev as number) - (b.walkAway.ev as number)).toBeCloseTo(5, 0);
    expect(b.opening.ev).toBeNull();
    expect(b.opening.basis).toMatch(/not set/);
    const c = bidRange.run({ ...input, openingDiscountPct: 10, targetDiscountPct: 5 }, analyst).structured;
    expect(c.target.ev).toBeCloseTo((c.walkAway.ev as number) * 0.95, 0);
    expect(c.opening.ev).toBeLessThan(c.target.ev as number);
  });

  it("labels default hurdles and says so when nothing clears", () => {
    const d = bidRange.run({ ebitda: 10, leverageMultiple: 4, ebitdaGrowthRate: 0.08, exitMultiple: 9 }, analyst);
    expect(d.structured.hurdlesAreDefault).toBe(true);
    expect(d.sources.some((s) => s.kind === "assumption" && s.label === "Return hurdles")).toBe(true);
    const none = bidRange.run({ ebitda: 10, ebitdaGrowthRate: -0.5, exitMultiple: 1, hurdles: { base: { irr: 0.5 }, holdYears: 5 } }, analyst);
    expect(none.structured.walkAway.ev).toBeNull();
    expect(none.structured.note).toMatch(/No entry price clears/);
  });

  it("flags a downside hurdle with no downside case, and a walk-away above the comps range", () => {
    const r = bidRange.run({ ...input, downsideCase: undefined, compsMultipleRange: { low: 3, high: 4 } }, analyst);
    expect(r.missingData.join(" ")).toMatch(/downside not tested/);
    expect(r.structured.walkAway.ev).toBeCloseTo(77.1, 0); // base-only ceiling, never NaN
    expect(r.structured.versusComps).toBe("above");
  });
});

describe("red-flag-register: the firm's evidence policy", () => {
  const f = [
    { title: "Churn spike", workstream: "commercial", severity: "amber" as const, impact: "price" as const, evidenceGrade: "C" as const, priceImpact: 3 },
    { title: "Lease gap", workstream: "financial", severity: "amber" as const, impact: "price" as const, evidenceGrade: "B" as const, priceImpact: 2 },
    { title: "Tax exposure", workstream: "tax", severity: "red" as const, impact: "price" as const, evidenceGrade: "A" as const, priceImpact: 5 },
  ];
  const ran = ["commercial", "financial", "tax"];

  it("uses the labelled standing default when the firm sets none", () => {
    const r = redFlagRegister.run({ findings: f, workstreamsRun: ran }, ctx);
    expect(r.structured.evidencePolicyIsDefault).toBe(true);
    expect(r.structured.supportedPriceAdjustment).toBe(7); // A + B
    expect(r.sources.some((s) => s.kind === "assumption" && s.label === "Evidence policy")).toBe(true);
  });

  it("a stricter firm policy excludes B, a looser one admits C, and U can never be admitted", () => {
    const strict = redFlagRegister.run({ findings: f, workstreamsRun: ran, evidencePolicy: { supportsPrice: { A: true, B: false, C: false } } }, ctx);
    expect(strict.structured.evidencePolicyIsDefault).toBe(false);
    expect(strict.structured.supportedPriceAdjustment).toBe(5);
    expect(strict.structured.unsupportedPriceClaims.map((c) => c.title).sort()).toEqual(["Churn spike", "Lease gap"]);

    const loose = redFlagRegister.run({ findings: f, workstreamsRun: ran, evidencePolicy: { supportsPrice: { A: true, B: true, C: true } } }, ctx);
    expect(loose.structured.supportedPriceAdjustment).toBe(10);

    const withU = redFlagRegister.run(
      { findings: [{ ...f[0], evidenceGrade: undefined }], workstreamsRun: ran, evidencePolicy: { supportsPrice: { A: true, B: true, C: true } } },
      ctx,
    );
    expect(withU.structured.register[0].evidenceGrade).toBe("U");
    expect(withU.structured.supportedPriceAdjustment).toBe(0); // ungraded = U, never supports a price
  });

  it("a partial policy keeps the default for the grades it does not mention", () => {
    const r = redFlagRegister.run({ findings: f, workstreamsRun: ran, evidencePolicy: { supportsPrice: { B: false } } }, ctx);
    expect(r.structured.supportedPriceAdjustment).toBe(5); // A still true by default, B now false
    expect(validate(r.structured, redFlagRegister.manifest.outputSchema).valid).toBe(true);
  });
});
