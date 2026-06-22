import { normalizePlans, generatePlans, type AgentPlan } from "@/lib/claude";

// A valid planner workflow item (the shape the LLM returns per workflow).
function wf(lifecycle_stage: string, agent = "analyst") {
  return {
    title: `${lifecycle_stage} work`,
    hub: "run",
    lifecycle_stage,
    summary: `Do the ${lifecycle_stage} slice`,
    steps: [{ agent, title: "Step one", description: "Do the thing" }],
  };
}

function stages(plans: AgentPlan[]) {
  return plans.map((p) => p.lifecycle_stage);
}

describe("normalizePlans (multi-intent)", () => {
  it("returns a single fallback plan when nothing valid comes back", () => {
    expect(normalizePlans(null, "do something")).toHaveLength(1);
    expect(normalizePlans({ workflows: [] }, "do something")).toHaveLength(1);
    expect(normalizePlans({}, "do something")).toHaveLength(1);
  });

  it("keeps multiple workflows when stages are distinct", () => {
    const plans = normalizePlans(
      { workflows: [wf("Underwriting"), wf("Reporting & Communications")] },
      "underwrite the deal and draft the LP update",
    );
    expect(plans).toHaveLength(2);
    expect(stages(plans)).toEqual(["Underwriting", "Reporting & Communications"]);
    // Engine + executive are derived from the stage on each plan.
    expect(plans[0].target_engine).toBe("Capital Stack Engine");
    expect(plans[1].target_engine).toBe("Reporting Engine");
  });

  it("collapses same-stage duplicates (not a genuine split)", () => {
    const plans = normalizePlans({ workflows: [wf("Underwriting"), wf("Underwriting", "associate")] }, "x");
    expect(plans).toHaveLength(1);
    expect(plans[0].lifecycle_stage).toBe("Underwriting");
  });

  it("caps at 3 workflows", () => {
    const plans = normalizePlans(
      {
        workflows: [
          wf("Underwriting"),
          wf("Diligence"),
          wf("Sourcing"),
          wf("Closing"),
          wf("Exit Planning"),
        ],
      },
      "do everything",
    );
    expect(plans).toHaveLength(3);
  });

  it("produces fully-formed plans (steps + routing fields)", () => {
    const [plan] = normalizePlans({ workflows: [wf("Diligence", "diligence")] }, "diligence");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.lifecycle_stage).toBe("Diligence");
    expect(plan.assigned_to).toBe("analyst");
  });
});

describe("generatePlans (no API key)", () => {
  it("falls back to a single deterministic plan", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const plans = await generatePlans("Build the diligence pack and prep the IC memo");
      expect(plans).toHaveLength(1);
      expect(plans[0].steps.length).toBeGreaterThan(0);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
