import {
  deriveRouting,
  buildRouting,
  routingFromTask,
  executiveForAgent,
  executiveForStage,
  engineForStage,
  cursorResponse,
  routingHeadline,
  isLifecycleStage,
  isTargetEngine,
  isExecutive,
  EXECUTIVE_LABEL,
  STAGE_TO_ENGINE,
  LIFECYCLE_STAGES,
  deskOverride,
  DESK_PRIMARY_AGENT,
  EXECUTIVES,
} from "@/lib/intelligence";

describe("executiveForAgent (mapping layer)", () => {
  it("maps modeling/underwriting agents to CIO", () => {
    expect(executiveForAgent("analyst")).toBe("cio");
    expect(executiveForAgent("capital_connector")).toBe("cio");
  });
  it("maps research/diligence agents to Analyst", () => {
    expect(executiveForAgent("diligence")).toBe("analyst");
    expect(executiveForAgent("deal_sourcer")).toBe("analyst");
  });
  it("maps capital-formation/messaging agents to CMO", () => {
    expect(executiveForAgent("investor_relations")).toBe("cmo");
    expect(executiveForAgent("pr_director")).toBe("cmo");
  });
  it("maps back-office/ops agents to COO (Earn)", () => {
    expect(executiveForAgent("fund_admin")).toBe("earn_coo");
    expect(executiveForAgent("portfolio_ops")).toBe("earn_coo");
  });
});

describe("deskOverride (Delegate & Route)", () => {
  it("every desk's representative agent resolves back to that desk", () => {
    // The delegation contract: repointing the primary agent to a desk's
    // representative must make `assigned_to` that desk (except CRO, which is
    // reached structurally via a forced compliance stage).
    for (const desk of EXECUTIVES) {
      const ov = deskOverride(desk);
      expect(ov.primaryAgent).toBe(DESK_PRIMARY_AGENT[desk]);
      const stage = ov.stage ?? "Sourcing";
      expect(executiveForStage(stage, ov.primaryAgent)).toBe(desk);
    }
  });

  it("pins a compliance stage + engine for CRO (no native agent)", () => {
    const ov = deskOverride("cro");
    expect(ov.stage).toBe("Compliance & Documentation");
    expect(ov.engine).toBe(engineForStage("Compliance & Documentation"));
  });

  it("leaves the stage to the plan for non-CRO desks", () => {
    expect(deskOverride("cio").stage).toBeNull();
    expect(deskOverride("cio").engine).toBeNull();
  });
});

describe("deriveRouting", () => {
  it("routes LP pipeline work to the Outbound Engine", () => {
    const r = deriveRouting({ prompt: "Find LPs and build an LP pipeline for the fund", hub: "source", agents: ["capital_raiser"] });
    expect(r.target_engine).toBe("Outbound Engine");
    expect(r.lifecycle_stage).toBe("Fundraising & LP Engagement");
    expect(r.assigned_to).toBe("cmo");
    expect(r.status).toBe("routed");
  });

  it("routes mandate/strategy work to the Mandate Engine", () => {
    const r = deriveRouting({ prompt: "Draft the mandate and refine the strategy", hub: "build", agents: ["associate"] });
    expect(r.target_engine).toBe("Mandate Engine");
    expect(r.lifecycle_stage).toBe("Mandate Definition");
  });

  it("routes diligence work to the Diligence Engine + Analyst", () => {
    const r = deriveRouting({ prompt: "Build a diligence pack from the data room", hub: "run", agents: ["diligence"] });
    expect(r.target_engine).toBe("Diligence Engine");
    expect(r.lifecycle_stage).toBe("Diligence");
    expect(r.assigned_to).toBe("analyst");
    expect(r.confidence).toBe("high");
  });

  it("routes capital-stack modeling to the Capital Stack Engine + CIO", () => {
    const r = deriveRouting({ prompt: "Model the capital stack with senior debt and mezz", hub: "execute", agents: ["capital_connector"] });
    expect(r.target_engine).toBe("Capital Stack Engine");
    expect(r.lifecycle_stage).toBe("Capital Stack Design");
    expect(r.assigned_to).toBe("cio");
  });

  it("routes IC memo prep to the Reporting Engine", () => {
    const r = deriveRouting({ prompt: "Prepare the IC memo for the committee", hub: "run", agents: ["associate"] });
    expect(r.target_engine).toBe("Reporting Engine");
    expect(r.lifecycle_stage).toBe("IC Preparation");
  });

  it("routes automation requests to the Workflow Builder", () => {
    const r = deriveRouting({ prompt: "Automate this workflow to run every week", hub: "run", agents: ["associate"] });
    expect(r.target_engine).toBe("Workflow Builder");
    expect(r.lifecycle_stage).toBe("Workflow Automation");
  });

  it("overrides the executive to CRO for compliance work, regardless of agent", () => {
    const r = deriveRouting({ prompt: "Run the KYC/AML compliance review on the subscription docs", hub: "execute", agents: ["analyst"] });
    expect(r.lifecycle_stage).toBe("Compliance & Documentation");
    expect(r.assigned_to).toBe("cro");
  });

  it("falls back to a hub default when no rule matches", () => {
    const r = deriveRouting({ prompt: "Help me think about the quarter", hub: "source", agents: ["associate"] });
    expect(r.target_engine).toBe("Outbound Engine");
    expect(r.lifecycle_stage).toBe("Sourcing");
    expect(r.confidence).toBe("low");
  });

  it("flags priority and extracts entities without inventing data", () => {
    const r = deriveRouting({ prompt: 'Underwrite "Acme Logistics" for $25M, urgent', hub: "run", agents: ["analyst"] });
    expect(r.payload.priority).toBe("high");
    expect(r.payload.entities).toContain("Acme Logistics");
    expect(r.payload.entities.some((e) => e.includes("25M"))).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const input = { prompt: "Build the LBO model and run sensitivities", hub: "run" as const, agents: ["analyst" as const] };
    expect(deriveRouting(input)).toEqual(deriveRouting(input));
  });
});

describe("cursorResponse", () => {
  it("produces Summary / Action / Next Step copy", () => {
    const r = deriveRouting({ prompt: "Build the diligence pack", hub: "run", agents: ["diligence"] });
    const pending = cursorResponse(r, { pending: true, stepCount: 3 });
    expect(pending.summary).toContain("Diligence");
    expect(pending.action).toContain("Diligence Engine");
    expect(pending.action).toContain(EXECUTIVE_LABEL[r.assigned_to]);
    expect(pending.nextStep).toMatch(/approve/i);

    const done = cursorResponse(r, { pending: false, stepCount: 3 });
    expect(done.nextStep).toMatch(/review/i);
  });
});

describe("routingHeadline", () => {
  it("renders stage → engine · executive", () => {
    const r = deriveRouting({ prompt: "Model the capital stack", hub: "execute", agents: ["capital_connector"] });
    expect(routingHeadline(r)).toBe("Capital Stack Design → Capital Stack Engine · CIO.AI");
  });
});

describe("engine mapping totality", () => {
  it("maps every lifecycle stage to exactly one engine", () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(isTargetEngine(STAGE_TO_ENGINE[stage])).toBe(true);
      expect(engineForStage(stage)).toBe(STAGE_TO_ENGINE[stage]);
    }
  });

  it("keeps deriveRouting's engine consistent with engineForStage(stage)", () => {
    const prompts = [
      "Draft the mandate",
      "Build the diligence pack",
      "Model the capital stack",
      "Find LPs for the fund",
      "Prepare the IC memo",
      "Summarize portfolio performance",
      "Automate this weekly",
    ];
    for (const p of prompts) {
      const r = deriveRouting({ prompt: p, hub: "run", agents: ["associate"] });
      expect(r.target_engine).toBe(engineForStage(r.lifecycle_stage));
    }
  });
});

describe("executiveForStage", () => {
  it("forces CRO for compliance regardless of agent", () => {
    expect(executiveForStage("Compliance & Documentation", "analyst")).toBe("cro");
  });
  it("otherwise follows the primary agent", () => {
    expect(executiveForStage("Underwriting", "analyst")).toBe(executiveForAgent("analyst"));
    expect(executiveForStage("Diligence", "diligence")).toBe("analyst");
  });
});

describe("buildRouting (authoritative path)", () => {
  it("derives engine + executive from the explicit stage", () => {
    const r = buildRouting({ prompt: "Stress the downside", hub: "run", agents: ["analyst"], stage: "Underwriting" });
    expect(r.target_engine).toBe("Capital Stack Engine");
    expect(r.assigned_to).toBe("cio");
    expect(r.lifecycle_stage).toBe("Underwriting");
    expect(r.confidence).toBe("high");
  });
  it("applies the CRO override when the stage is compliance", () => {
    const r = buildRouting({ prompt: "KYC review", hub: "execute", agents: ["analyst"], stage: "Compliance & Documentation" });
    expect(r.assigned_to).toBe("cro");
  });
  it("still extracts payload entities/priority", () => {
    const r = buildRouting({ prompt: 'Underwrite "Acme" now, urgent', hub: "run", agents: ["analyst"], stage: "Underwriting" });
    expect(r.payload.priority).toBe("high");
    expect(r.payload.entities).toContain("Acme");
  });
});

describe("routingFromTask (read-back)", () => {
  it("uses the persisted stage when present", () => {
    const r = routingFromTask({ prompt: "anything at all", hub: "run", agents: ["analyst"], stage: "Closing" });
    expect(r.lifecycle_stage).toBe("Closing");
    expect(r.target_engine).toBe("Capital Stack Engine");
  });
  it("falls back to deterministic classification for null/invalid stage", () => {
    const r = routingFromTask({ prompt: "Build the diligence pack", hub: "run", agents: ["diligence"], stage: null });
    expect(r.lifecycle_stage).toBe("Diligence");
    const bad = routingFromTask({ prompt: "Build the diligence pack", hub: "run", agents: ["diligence"], stage: "Not A Stage" });
    expect(bad.lifecycle_stage).toBe("Diligence");
  });
});

describe("type guards", () => {
  it("validate stages, engines, and executives", () => {
    expect(isLifecycleStage("Diligence")).toBe(true);
    expect(isLifecycleStage("nope")).toBe(false);
    expect(isTargetEngine("Diligence Engine")).toBe(true);
    expect(isTargetEngine("nope")).toBe(false);
    expect(isExecutive("cro")).toBe(true);
    expect(isExecutive("nope")).toBe(false);
  });
});
