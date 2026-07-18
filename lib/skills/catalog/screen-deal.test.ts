// Golden tests for the screen-deal deterministic core.
import { screenDeal, type ScreenDealInput } from "./screen-deal";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: ScreenDealInput) => screenDeal.run(input, ctx);

describe("screen-deal core", () => {
  it("passes a clean mandate-fit buyout and computes the EV/EBITDA multiple", () => {
    const r = run({
      mandate: { sectors: ["industrials", "manufacturing"], geographies: ["north america"], minRevenue: 20, maxRevenue: 200, minEbitda: 3, maxEbitda: 40, exclusions: ["gambling", "tobacco"] },
      deal: { companyName: "Acme Widgets", sector: "Manufacturing", geography: "North America", revenue: 80, ebitda: 12, enterpriseValue: 96, ownership: "Founder-owned", transactionType: "Buyout" },
    });
    expect(r.structured.verdict).toBe("pass");
    expect(r.structured.preliminaryValuation.evEbitdaMultiple).toBe(8); // 96 / 12
    expect(r.structured.mandateFit.overall).toBeGreaterThanOrEqual(70);
    // The multiple is recorded as a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "EV / EBITDA multiple")?.kind).toBe("calculation");
  });

  it("fails on a mandate exclusion hit", () => {
    const r = run({
      mandate: { sectors: ["consumer"], exclusions: ["tobacco"] },
      deal: { companyName: "SmokeCo", sector: "Tobacco", revenue: 50, ebitda: 10 },
    });
    expect(r.structured.verdict).toBe("fail");
    expect(r.structured.exclusionHits).toContain("tobacco");
  });

  it("watches and FLAGS missing data instead of inventing it", () => {
    const r = run({
      mandate: { sectors: ["software"], minRevenue: 10 },
      deal: { companyName: "Mystery SaaS", sector: "Software" },
    });
    expect(r.structured.verdict).toBe("watch");
    expect(r.structured.preliminaryValuation.evEbitdaMultiple).toBeNull();
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(["Revenue", "EBITDA", "Enterprise value"]));
    // Nothing fabricated: no fact source carries a revenue/ebitda number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Revenue")).toBe(false);
    expect(r.completeness).toBeLessThan(0.5);
  });

  it("fails a clearly out-of-band size", () => {
    const r = run({
      mandate: { sectors: ["software"], minRevenue: 100, maxRevenue: 500 },
      deal: { companyName: "TinyCo", sector: "Software", geography: "EU", revenue: 5, ebitda: 1, enterpriseValue: 10 },
    });
    expect(r.structured.verdict).toBe("fail");
    expect(r.structured.mandateFit.size.status).toBe("miss");
  });

  it("labels the leverage band as an ASSUMPTION", () => {
    const r = run({ mandate: {}, deal: { companyName: "Levered Co", ebitda: 20 } });
    expect(r.structured.leverageConsideration).toContain("ASSUMPTION");
    expect(r.sources.find((s) => s.label === "Assumed leverage band")?.kind).toBe("assumption");
  });

  it("does not penalize unknown dimensions as misses", () => {
    const r = run({ mandate: {}, deal: { companyName: "Bare Co" } });
    // Empty mandate + no deal data → unknown fits, not misses; should not be 'fail' purely from unknowns.
    expect(r.structured.mandateFit.sector.status).toBe("unknown");
    expect(["watch", "pass"]).toContain(r.structured.verdict);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ mandate: {}, deal: { companyName: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
    expect(r.structured.diligencePriorities.length).toBeGreaterThan(0);
  });
});
