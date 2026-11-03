// Tests for the deterministic skill planner (step → governed skill on real input).
import { planSkillForStep, type SkillPlanningContext } from "./skill-planner";
import { executeSkillCore } from "./runner";
import { canRunSkill } from "@/lib/executives/registry";
import type { SkillContext } from "./types";
import { EMPTY_MANDATE, parseMandateTests } from "@/lib/pe/mandate-tests";

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

describe("planSkillForStep — PE sourcing skills", () => {
  const MANDATE = parseMandateTests({
    status: "approved",
    hardLimits: [{ id: "geo", label: "Geography", metric: "geography", allow: ["UK"], source: "LPA 9.1" }],
    preferences: [{ id: "e", label: "EBITDA", metric: "ebitda", strong: { min: 5 }, weight: 1 }],
    killFacts: [],
  })!;

  it("plans mandate-screen only when the org has stored mandate tests", () => {
    expect(planSkillForStep("Define the mandate screen", "", {})).toBeNull();
    expect(planSkillForStep("Define the mandate screen", "", { mandateTests: EMPTY_MANDATE })).toBeNull();
    const plan = planSkillForStep("Define the mandate screen", "", { mandateTests: MANDATE })!;
    expect(plan.skillId).toBe("mandate-screen");
    expect(plan.input).toEqual({ mandate: MANDATE });
  });

  it("plans first-look from a real deal record, forwarding only the facts it carries", () => {
    const ctx: SkillPlanningContext = { mandateTests: MANDATE, deal: { companyName: "Acme", geography: "UK", ebitda: 8, askingPrice: 99 } };
    const plan = planSkillForStep("First look at the teaser", "", ctx)!;
    expect(plan.skillId).toBe("first-look");
    expect(plan.input).toEqual({ mandate: MANDATE, deal: { name: "Acme", geography: "UK", ebitda: 8 } }); // no invented fields; askingPrice is not a mandate fact
    expect(planSkillForStep("First look at the teaser", "", { mandateTests: MANDATE, deal: {} })).toBeNull(); // no name -> no invention
    expect(planSkillForStep("First look at the teaser", "", { deal: { companyName: "Acme" } })).toBeNull(); // no mandate
  });

  it("plans target-screen from a supplied list and the stored mandate", () => {
    const ctx: SkillPlanningContext = { mandateTests: MANDATE, candidates: [{ name: "A", geography: "UK", ebitda: 9 }, { name: "  " } as never] };
    const plan = planSkillForStep("Target screening", "", ctx)!;
    expect(plan.skillId).toBe("target-screen");
    expect((plan.input as { targets: unknown[] }).targets).toEqual([{ name: "A", geography: "UK", ebitda: 9 }]);
    expect(planSkillForStep("Target screening", "", { mandateTests: MANDATE })).toBeNull();
  });

  it("the assembled inputs run through the governed runtime and the executive may run them", () => {
    const run = (title: string, ctx: SkillPlanningContext) => {
      const plan = planSkillForStep(title, "", ctx)!;
      expect(canRunSkill(plan.executive, plan.skillId)).toBe(true);
      const sctx: SkillContext = { workspaceId: "o", principalId: "p", executive: plan.executive };
      return executeSkillCore(plan.skillId, plan.input, sctx);
    };
    const a = run("First look at the teaser", { mandateTests: MANDATE, deal: { companyName: "Acme", geography: "UK", ebitda: 8 } });
    expect(a.ok).toBe(true);
    expect((a.structured as { view: string }).view).toBe("ask-more"); // numbers carry no source reference
    expect(run("Define the mandate screen", { mandateTests: MANDATE }).ok).toBe(true);
    expect(run("Target screening", { mandateTests: MANDATE, candidates: [{ name: "A", geography: "UK", ebitda: 9 }] }).ok).toBe(true);
  });

  it("defers the PE skills that need rich structured input rather than inventing it", () => {
    for (const step of ["Set the bid price range", "Run the quality of earnings bridge", "Covenant headroom", "13-week cash forecast", "Exit options paper"]) {
      expect(planSkillForStep(step, "", { mandateTests: MANDATE, deal: { companyName: "Acme", ebitda: 8 } })).toBeNull();
    }
  });
});

