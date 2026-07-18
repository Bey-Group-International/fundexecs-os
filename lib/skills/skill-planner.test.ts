// Tests for the deterministic skill planner (step → governed skill on real input).
import { planSkillForStep, type SkillPlanningContext } from "./skill-planner";
import { executeSkillCore } from "./runner";
import { canRunSkill } from "@/lib/executives/registry";
import type { SkillContext } from "./types";

const CRITERIA = { sectors: ["software"], geographies: ["north america"], minRevenue: 10, maxRevenue: 100 };

describe("planSkillForStep — screen-deal", () => {
  it("plans screen-deal when a named deal AND usable criteria are present", () => {
    const ctx: SkillPlanningContext = {
      criteria: CRITERIA,
      deal: { companyName: "Acme Software", sector: "Software", geography: "North America", revenue: 40 },
    };
    const plan = planSkillForStep("Screen this opportunity against our mandate", "", ctx);
    expect(plan).not.toBeNull();
    expect(plan!.skillId).toBe("screen-deal");
    expect(plan!.executive).toBe("analyst");
    expect(plan!.input).toEqual({
      mandate: CRITERIA,
      deal: { companyName: "Acme Software", sector: "Software", geography: "North America", revenue: 40 },
    });
  });

  it("the assembled input actually runs through the governed runtime", () => {
    const ctx: SkillPlanningContext = {
      criteria: CRITERIA,
      deal: { companyName: "Acme Software", sector: "Software", geography: "North America", revenue: 40 },
    };
    const plan = planSkillForStep("Screen the deal", "", ctx)!;
    expect(canRunSkill(plan.executive, plan.skillId)).toBe(true);
    const skillCtx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: plan.executive };
    const result = executeSkillCore(plan.skillId, plan.input, skillCtx);
    expect(result.ok).toBe(true);
    expect(result.structured).not.toBeNull();
  });

  it("returns null without a company name (never fabricates one)", () => {
    const plan = planSkillForStep("Screen the deal", "", { criteria: CRITERIA, deal: { sector: "Software" } });
    expect(plan).toBeNull();
  });

  it("returns null when there are no usable criteria to screen against", () => {
    const plan = planSkillForStep("Screen the deal", "", { criteria: null, deal: { companyName: "Acme" } });
    expect(plan).toBeNull();
    const plan2 = planSkillForStep("Screen the deal", "", { criteria: {}, deal: { companyName: "Acme" } });
    expect(plan2).toBeNull();
  });

  it("forwards only fields that are actually present — never invents a figure", () => {
    const ctx: SkillPlanningContext = { criteria: CRITERIA, deal: { companyName: "Acme", sector: "Software" } };
    const plan = planSkillForStep("Mandate-fit check", "", ctx)!;
    const deal = (plan.input as { deal: Record<string, unknown> }).deal;
    expect(deal).toEqual({ companyName: "Acme", sector: "Software" });
    // No revenue / ebitda / geography were supplied, so none appear.
    expect("revenue" in deal).toBe(false);
    expect("ebitda" in deal).toBe(false);
    expect("geography" in deal).toBe(false);
  });
});

describe("planSkillForStep — source-deals", () => {
  it("plans source-deals when a candidate set is supplied", () => {
    const ctx: SkillPlanningContext = {
      criteria: CRITERIA,
      candidates: [
        { name: "Target A", sector: "Software", geography: "North America", revenue: 50 },
        { name: "Target B", sector: "Retail" },
      ],
    };
    const plan = planSkillForStep("Source targets for the mandate", "", ctx);
    expect(plan).not.toBeNull();
    expect(plan!.skillId).toBe("source-deals");
    expect(plan!.executive).toBe("deal_sourcer");
    const input = plan!.input as { mandate: unknown; candidates: unknown[] };
    expect(input.mandate).toEqual(CRITERIA);
    expect(input.candidates).toHaveLength(2);
    // The assembled input runs.
    const result = executeSkillCore(plan!.skillId, plan!.input, {
      workspaceId: "o",
      principalId: "p",
      executive: plan!.executive,
    });
    expect(result.ok).toBe(true);
  });

  it("returns null with no candidates (never fabricates targets)", () => {
    expect(planSkillForStep("Source deals", "", { criteria: CRITERIA, candidates: [] })).toBeNull();
    expect(planSkillForStep("Source deals", "", { criteria: CRITERIA })).toBeNull();
  });

  it("drops nameless candidates rather than inventing names", () => {
    const ctx: SkillPlanningContext = {
      criteria: CRITERIA,
      candidates: [{ name: "" }, { name: "  " }, { name: "Real Co", sector: "Software" }] as never,
    };
    const plan = planSkillForStep("Rank the candidates", "", ctx)!;
    const input = plan.input as { candidates: { name: string }[] };
    expect(input.candidates).toEqual([{ name: "Real Co", sector: "Software" }]);
  });
});

describe("planSkillForStep — deferral", () => {
  it("returns null for a non-skill step", () => {
    expect(planSkillForStep("Draft an intro email to the founder", "", { criteria: CRITERIA })).toBeNull();
  });

  it("defers detectable skills whose structured input is not present (returns, ic-memo, dd-checklist)", () => {
    const ctx: SkillPlanningContext = { criteria: CRITERIA, deal: { companyName: "Acme" } };
    expect(planSkillForStep("Build a returns case", "", ctx)).toBeNull();
    expect(planSkillForStep("Prepare an IC pre-read", "", ctx)).toBeNull();
    expect(planSkillForStep("Generate a diligence checklist", "", ctx)).toBeNull();
  });
});
