// Tests for the engine skill-run helper. persistSkillRun no-ops without a service
// env, so the helper runs purely here — we assert the rendered deliverable.
import { executePlannedSkill } from "./engine-run";
import { planSkillForStep } from "./skill-planner";

const CRITERIA = { sectors: ["software"], geographies: ["north america"], minRevenue: 10, maxRevenue: 100 };

describe("executePlannedSkill", () => {
  it("runs a planned screen-deal and renders a reviewable deliverable", async () => {
    const plan = planSkillForStep("Screen the deal", "", {
      criteria: CRITERIA,
      deal: { companyName: "Acme Software", sector: "Software", geography: "North America", revenue: 40 },
    })!;
    const ran = await executePlannedSkill({ orgId: "o", actorId: "a", plan });
    expect(ran.ok).toBe(true);
    // The rendered output leads with the skill name and carries provenance.
    expect(ran.output).toContain("Structured output");
    expect(ran.output).toContain("Provenance");
    expect(ran.backingAgent).toBe("analyst");
  });

  it("reports a governed rejection as a non-ok result rather than throwing", async () => {
    // Force a rejection: an executive not permitted to run the skill.
    const ran = await executePlannedSkill({
      orgId: "o",
      actorId: "a",
      plan: { skillId: "screen-deal", executive: "communications", input: { mandate: CRITERIA, deal: { companyName: "X" } } },
    });
    expect(ran.ok).toBe(false);
    expect(ran.output).toContain("could not run");
  });
});
