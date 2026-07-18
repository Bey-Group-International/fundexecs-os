import { normalizePlans, generatePlans, effortConfig, tryGatewayText, executeStep, type AgentPlan } from "@/lib/claude";

// output_config.effort 400s on Haiku 4.5 / Sonnet 4.5 but output_config.format
// (structured outputs) is supported on Haiku 4.5 — effortConfig must gate only
// the effort field. This is the fix for the chat "Earn ran into an issue" error,
// where the simple-query router selects Haiku.
describe("effortConfig — Haiku-safe output_config", () => {
  const SCHEMA = { type: "object", additionalProperties: false, properties: {}, required: [] };

  it("omits effort entirely on Haiku (no output_config when no schema)", () => {
    expect(effortConfig("claude-haiku-4-5-20251001", "low")).toEqual({});
  });

  it("keeps format but drops effort on Haiku", () => {
    expect(effortConfig("claude-haiku-4-5-20251001", "low", SCHEMA)).toEqual({
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  });

  it("includes effort on models that support it (Sonnet 4.6)", () => {
    expect(effortConfig("claude-sonnet-4-6", "low")).toEqual({ output_config: { effort: "low" } });
    expect(effortConfig("claude-sonnet-4-6", "medium", SCHEMA)).toEqual({
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    });
  });

  it("includes effort on Opus 4.8", () => {
    expect(effortConfig("claude-opus-4-8", "low")).toEqual({ output_config: { effort: "low" } });
  });
});

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

describe("gateway routing (CLAUDE_VIA_GATEWAY_ENABLED, default off)", () => {
  it("tryGatewayText returns null when the flag is off — callers use the direct path", async () => {
    // The flag is read at module load; in the test env it is unset (off), so the
    // gateway is never consulted and every caller falls through to Anthropic.
    const text = await tryGatewayText({
      system: "s",
      prompt: "p",
      capability: "financial_reasoning",
      maxTokens: 100,
      purpose: "test",
    });
    expect(text).toBeNull();
  });

  it("executeStep is unchanged when the flag is off and no API key is set (deterministic fallback)", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await executeStep({
        workflowTitle: "Test Workflow",
        agent: "analyst",
        stepTitle: "Draft a summary",
        stepDescription: "Summarize the opportunity",
        priorOutputs: [],
      });
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
