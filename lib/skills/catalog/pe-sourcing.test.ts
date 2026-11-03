// Golden tests for the PE-department sourcing skills (mandate-screen, target-screen, first-look).
import { mandateScreen } from "./mandate-screen";
import { targetScreen } from "./target-screen";
import { firstLook } from "./first-look";
import { validate } from "@/lib/skills/validate";
import { FIXTURE } from "@/lib/pe/test-fixture";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "deal_sourcer" };
const good = { geography: "UK", sector: "Software", ownershipPct: 100, equityChequePct: 10, ebitda: 10, ebitdaMargin: 25, topCustomerPct: 12 };

describe("mandate-screen", () => {
  it("restates the mandate as a table and is ready for sign-off when clean", () => {
    const r = mandateScreen.run({ mandate: FIXTURE, gateOwner: "Managing Partner" }, ctx);
    expect(r.structured.rows).toHaveLength(9);
    expect(r.structured.readyForSignOff).toBe(true);
    expect(r.structured.gate).toContain("Managing Partner");
    expect(validate(r.structured, mandateScreen.manifest.outputSchema).valid).toBe(true);
  });

  it("blocks sign-off when a criterion has no number", () => {
    const r = mandateScreen.run({ mandate: { status: "draft", hardLimits: [{ id: "a", label: "Size", metric: "ebitda" }], preferences: [], killFacts: [] } }, ctx);
    expect(r.structured.readyForSignOff).toBe(false);
    expect(r.structured.basis).toBe("default-screened");
    expect(r.missingData.length).toBeGreaterThan(0);
  });
});

describe("target-screen", () => {
  it("ranks survivors by score, then needs-data, then fails, citing each fail", () => {
    const r = targetScreen.run(
      {
        mandate: FIXTURE,
        targets: [
          { name: "Low", ...good, ebitda: 6, ebitdaMargin: 14 },
          { name: "Nodata", sector: "Software" },
          { name: "Top", ...good },
          { name: "Wrong geo", ...good, geography: "France" },
        ],
      },
      ctx,
    );
    const names = r.structured.results.map((x) => x.name);
    expect(names).toEqual(["Top", "Low", "Nodata", "Wrong geo"]);
    expect(r.structured.results[0].rank).toBe(1);
    expect(r.structured.results[1].rank).toBe(2);
    expect(r.structured.results[3].rank).toBeNull();
    expect(r.structured.results[3].criteriaFailed[0]).toContain("LPA 9.1");
    expect(r.structured.counts).toEqual({ pass: 2, fail: 1, needsData: 1 });
    expect(validate(r.structured, targetScreen.manifest.outputSchema).valid).toBe(true);
  });
});

describe("first-look", () => {
  const deal = {
    name: "Acme",
    ...good,
    ebitda: undefined,
    reportedEbitda: 8,
    adjustments: [
      { label: "Owner salary", amount: 1.5, sourceRef: "CIM p.21" },
      { label: "One-off legal", amount: 0.5, sourceRef: "CIM p.22" },
    ],
    statedAdjustedEbitda: 10,
    revenue: 40,
    sourceRefs: { reportedEbitda: "CIM p.20", revenue: "CIM p.14", ebitdaMargin: "CIM p.15" },
  };

  it("lists adjustments individually, computes adjusted EBITDA as a calculation, and says go", () => {
    const r = firstLook.run({ mandate: FIXTURE, deal }, ctx);
    expect(r.structured.ebitdaBridge.adjusted).toBe(10);
    expect(r.structured.ebitdaBridge.reconciles).toBe(true);
    expect(r.structured.ebitdaBridge.adjustments).toHaveLength(2);
    expect(r.sources.find((s) => s.label === "Adjusted EBITDA")?.kind).toBe("calculation");
    expect(r.structured.view).toBe("go");
    expect(r.structured.threeFactsThatWouldKillIt).toContain("Founder unwilling to roll equity");
    expect(validate(r.structured, firstLook.manifest.outputSchema).valid).toBe(true);
  });

  it("will not say go on unsourced numbers", () => {
    const r = firstLook.run({ mandate: FIXTURE, deal: { ...deal, sourceRefs: {} } }, ctx);
    expect(r.structured.view).toBe("ask-more");
    expect(r.structured.unsourcedNumbers).toEqual(expect.arrayContaining(["revenue"]));
  });

  it("says no-go on a hard-limit breach and flags a non-reconciling seller figure", () => {
    const r = firstLook.run({ mandate: FIXTURE, deal: { ...deal, geography: "France", statedAdjustedEbitda: 13 } }, ctx);
    expect(r.structured.view).toBe("no-go");
    expect(r.structured.ebitdaBridge.reconciles).toBe(false);
    expect(r.structured.threeReasonsItCouldFail.join(" ")).toMatch(/LPA 9.1/);
  });

  it("asks for more when a hard limit cannot be tested", () => {
    const r = firstLook.run({ mandate: FIXTURE, deal: { name: "Thin", revenue: 10 } }, ctx);
    expect(r.structured.view).toBe("ask-more");
  });
});
