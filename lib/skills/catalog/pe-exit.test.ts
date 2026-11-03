// Golden tests for the PE-department exit + IPO skills.
import { exitReadiness } from "./exit-readiness";
import { ipoReadiness } from "./ipo-readiness";
import { exitRoutes } from "./exit-routes";
import { dataRoomPrep } from "./data-room-prep";
import { finalInvestmentReport } from "./final-investment-report";
import { flowStats } from "@/lib/pe/xirr";
import { assessReadiness } from "@/lib/pe/readiness";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "portfolio_ops" };

describe("xirr / flowStats", () => {
  it("computes IRR from dated flows, not annual approximations", () => {
    // -100 on 2020-01-01, +200 on 2023-01-01 (3 years, act/365 = 1096 days) -> 2^(365/1096)-1
    const s = flowStats([{ date: "2020-01-01", amount: -100 }, { date: "2023-01-01", amount: 200 }]);
    expect(s.moic).toBe(2);
    expect(s.irr).toBeCloseTo(Math.pow(2, 365 / 1096) - 1, 3);
  });
  it("returns null IRR without a sign change or with bad dates", () => {
    expect(flowStats([{ date: "2020-01-01", amount: -100 }]).irr).toBeNull();
    const bad = flowStats([{ date: "nope", amount: -100 }, { date: "2023-01-01", amount: 200 }]);
    expect(bad.badDates).toBe(1);
    expect(bad.irr).toBeNull();
  });
  it("handles interim distributions", () => {
    const s = flowStats([{ date: "2020-01-01", amount: -100 }, { date: "2021-01-01", amount: 50 }, { date: "2023-01-01", amount: 120 }]);
    expect(s.invested).toBe(100);
    expect(s.returned).toBe(170);
    expect(s.irr as number).toBeGreaterThan(0.15);
    expect(s.irr as number).toBeLessThan(0.3);
  });
});

describe("assessReadiness", () => {
  it("never reads unknown or evidence-free met as met; reports timing parallel and serial", () => {
    const r = assessReadiness([
      { id: "a", area: "Finance", requirement: "Audited accounts", status: "met" },
      { id: "b", area: "Finance", requirement: "Close in 10 days", status: "gap", owner: "CFO", dueDate: "2027-01-31", weeksToClose: 8 },
      { id: "c", area: "Legal", requirement: "Clean cap table", status: "partial", weeksToClose: 4 },
      { id: "d", area: "HR", requirement: "Key-man contracts", status: "unknown", critical: false },
    ]);
    expect(r.items[0].effectiveStatus).toBe("unverified");
    expect(r.counts).toEqual({ met: 0, partial: 1, gap: 1, unknown: 1, unverified: 1 });
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(3); // a (unverified), b, c — d is non-critical
    expect(r.weeksIfParallel).toBe(8);
    expect(r.weeksIfSerial).toBe(12);
    expect(r.items[2].flags.join(" ")).toMatch(/without an owner or a date/);
  });
  it("is ready only when every critical item is met with evidence", () => {
    expect(assessReadiness([{ id: "a", area: "x", requirement: "y", status: "met", evidence: "Audit 2025 p.1" }]).ready).toBe(true);
    expect(assessReadiness([]).ready).toBe(false);
  });
});

describe("exit-readiness", () => {
  it("removes equity-story claims that have no proof and says so", () => {
    const r = exitReadiness.run(
      {
        company: "Acme",
        items: [{ id: "a", area: "Finance", requirement: "Audited accounts", status: "met", evidence: "Audit 2025" }],
        equityStory: [{ claim: "Market leader", proof: "Gartner 2025 p.4" }, { claim: "Best margins", proof: "KPI pack" }, { claim: "Sticky revenue", proof: "RQ analysis" }, { claim: "Obvious winner" }],
      },
      ctx,
    );
    expect(r.structured.ready).toBe(true);
    expect(r.structured.equityStory.kept).toHaveLength(3);
    expect(r.structured.equityStory.removed).toEqual(["Obvious winner"]);
    expect(r.structured.equityStory.sizeOk).toBe(true);
    expect(r.missingData.join(" ")).toMatch(/removed for lack of proof: "Obvious winner"/);
    expect(validate(r.structured, exitReadiness.manifest.outputSchema).valid).toBe(true);
  });
});

describe("ipo-readiness", () => {
  it("holds no listing rules: an uncited requirement is flagged", () => {
    const r = ipoReadiness.run(
      {
        company: "Acme",
        exchange: "LSE Main Market",
        items: [
          { id: "g1", area: "Governance", requirement: "Majority independent board", status: "gap", sourceRule: "UK Corporate Governance Code, Provision 11", owner: "Chair", dueDate: "2027-02-01", weeksToClose: 12 },
          { id: "f1", area: "Reporting", requirement: "3 years audited accounts", status: "met", evidence: "Audit 2023-25" },
        ],
      },
      ctx,
    );
    expect(r.structured.uncitedRequirements).toEqual(["Reporting: 3 years audited accounts"]);
    expect(r.structured.ready).toBe(false);
    expect(r.structured.weeksIfParallel).toBe(12);
    expect(r.missingData.join(" ")).toMatch(/No source rule: Reporting/);
    expect(validate(r.structured, ipoReadiness.manifest.outputSchema).valid).toBe(true);
  });
});

describe("exit-routes", () => {
  const input = {
    company: "Acme",
    equityInvested: 100,
    ownershipPct: 80,
    netDebtAtExit: 100,
    yearsHeld: 3,
    fundLifeRemainingMonths: 18,
    hurdles: { base: { irr: 0.2, moic: 2 }, holdYears: 5 },
    routes: [
      { name: "Trade sale", evLow: 500, evHigh: 600, basis: "3 indicative bids", monthsToClose: 9, certainty: "high" as const, costPct: 2 },
      { name: "IPO", evLow: 550, evHigh: 700, basis: "Comps", monthsToClose: 24, certainty: "low" as const, costPct: 4 },
      { name: "Secondary", evLow: 300, evHigh: 380, basis: "Broker view", monthsToClose: 6, certainty: "medium" as const, costPct: 2 },
      { name: "Recap", evLow: 400, evHigh: 500, monthsToClose: 4, certainty: "medium" as const, costPct: 1 },
    ],
  };

  it("computes net proceeds, tests the hurdle at the low end and fund life, and orders by stated certainty", () => {
    const r = exitRoutes.run(input, ctx);
    const by = Object.fromEntries(r.structured.routes.map((x) => [x.name, x]));
    // Trade sale low: 500*0.98 = 490 - 100 = 390 * 0.8 = 312 -> MOIC 3.12x over 3.75y
    expect(by["Trade sale"].proceedsLow).toBe(312);
    expect(by["Trade sale"].moicLow).toBe(3.12);
    expect(by["Trade sale"].hurdleAtLow).toBe("clears");
    expect(by["Trade sale"].rank).toBe(1);
    expect(by["IPO"].fitsFundLife).toBe(false);
    expect(by["IPO"].eligible).toBe(false);
    expect(by["Secondary"].hurdleAtLow).toBe("misses"); // (300*.98-100)*.8 = 153.6 -> 1.54x
    expect(by["Recap"].basisCited).toBe(false);
    expect(by["Recap"].eligible).toBe(false);
    expect(r.structured.primary).toBe("Trade sale");
    expect(r.structured.fallback).toBeNull();
    expect(validate(r.structured, exitRoutes.manifest.outputSchema).valid).toBe(true);
  });

  it("says no route is eligible rather than forcing a pick, and labels default hurdles", () => {
    const r = exitRoutes.run({ ...input, hurdles: undefined, routes: [input.routes[2]] }, ctx);
    expect(r.structured.primary).toBeNull();
    expect(r.structured.hurdlesAreDefault).toBe(true);
    expect(r.narrative).toMatch(/no route is eligible/);
  });
});

describe("data-room-prep", () => {
  const docs = [
    { name: "Audit 2023-25.pdf", workstream: "financial", answers: ["fin-1"] },
    { name: "Customer file.xlsx", workstream: "commercial", answers: ["com-1"], sensitivity: "competitor-sensitive" as const },
    { name: "Staff census.xlsx", workstream: "people", answers: ["hr-1"], sensitivity: "personal-data" as const },
    { name: "Key contract.pdf", workstream: "legal", answers: ["leg-2", "zzz-9"], sensitivity: "third-party-confidential" as const },
    { name: "Pricing deck.pdf", workstream: "commercial", sensitivity: "competitor-sensitive" as const, staged: true },
  ];

  it("maps requests to documents or gaps, builds the redaction list, and opens a Q&A row per gap", () => {
    const r = dataRoomPrep.run({ company: "Acme", documents: docs, qaOwner: "VDR admin", qaResponseHours: 48 }, ctx);
    const s = r.structured;
    expect(s.coverage.find((c) => c.requestId === "fin-1")?.status).toBe("covered");
    expect(s.gaps).toContain("fin-2: Monthly management accounts, last 24 months and LTM");
    expect(s.redactionList.map((x) => x.document).sort()).toEqual(["Customer file.xlsx", "Key contract.pdf", "Staff census.xlsx"]);
    expect(s.redactionList.find((x) => x.document === "Pricing deck.pdf")).toBeUndefined(); // staged
    expect(s.qaLog).toHaveLength(s.gaps.length);
    expect(s.qaLog[0]).toMatchObject({ ref: "QA-001", owner: "VDR admin", respondWithinHours: 48 });
    expect(s.requestListIsDefault).toBe(true);
    expect(r.missingData.join(" ")).toMatch(/answers unknown request id "zzz-9"/);
    expect(r.missingData.join(" ")).toMatch(/buyer's real request list/);
    expect(validate(s, dataRoomPrep.manifest.outputSchema).valid).toBe(true);
  });

  it("uses the supplied request list and stops flagging a default", () => {
    const r = dataRoomPrep.run({ company: "Acme", documents: docs, expectedRequests: [{ id: "fin-1", workstream: "financial", request: "Audit" }] }, ctx);
    expect(r.structured.requestListIsDefault).toBe(false);
    expect(r.structured.gaps).toEqual([]);
  });
});

describe("final-investment-report", () => {
  const input = {
    company: "Acme",
    cashFlows: [{ date: "2020-01-01", amount: -100 }, { date: "2025-01-01", amount: 300 }],
    entry: { ebitda: 10, multiple: 8, netDebt: 50 },
    exit: { ebitda: 16, multiple: 9, netDebt: 20 },
    hurdles: { base: { irr: 0.2, moic: 2.5 }, holdYears: 5 },
    fundRecord: { moic: 3, irr: 0.2457 },
    underwriting: { irr: 0.22, moic: 2.7 },
    thesis: [{ claim: "Buy-and-build", outcome: "4 add-ons closed", evidence: "Board pack Q4" }, { claim: "Margin expansion" }],
    lessons: ["Integrate faster"],
  };

  it("bridges returns so the three effects sum to value created, and ties to fund records", () => {
    const r = finalInvestmentReport.run(input, ctx);
    const s = r.structured;
    // entry equity 80-50=30; exit equity 144-20=124; value created 94
    expect(s.bridge.entryEquity).toBe(30);
    expect(s.bridge.exitEquity).toBe(124);
    expect(s.bridge.valueCreated).toBe(94);
    expect(s.bridge.ebitdaGrowth).toBe(48); // (16-10)*8
    expect(s.bridge.multipleChange).toBe(16); // (9-8)*16
    expect(s.bridge.deleveraging).toBe(30);
    expect(s.bridge.ties).toBe(true);
    expect(s.bridge.sharePct.ebitdaGrowth).toBe(51.06);
    expect(s.realised.moic).toBe(3);
    expect(s.realised.irr).toBeCloseTo(0.2457, 2);
    expect(s.hurdleVerdict).toBe("clears");
    expect(s.fundTie.moicTies).toBe(true);
    expect(s.versusUnderwriting?.moicDelta).toBeCloseTo(0.3, 3);
    expect(s.thesisReview.find((t) => t.claim === "Margin expansion")?.reviewable).toBe(false);
    expect(r.missingData.join(" ")).toMatch(/no outcome recorded: "Margin expansion"/);
    expect(r.sources.find((x) => x.label === "Realised IRR")?.kind).toBe("calculation");
    expect(validate(s, finalInvestmentReport.manifest.outputSchema).valid).toBe(true);
  });

  it("flags returns that do not tie to the fund's records, and an untested hurdle", () => {
    const r = finalInvestmentReport.run({ ...input, hurdles: undefined, fundRecord: { moic: 2.4 } }, ctx);
    expect(r.structured.fundTie.moicTies).toBe(false);
    expect(r.structured.hurdleVerdict).toBe("not-tested");
    expect(r.missingData.join(" ")).toMatch(/do not tie to the fund's records/);
  });
});
