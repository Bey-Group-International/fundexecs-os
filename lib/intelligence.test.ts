import {
  deriveRouting,
  executiveForAgent,
  cursorResponse,
  routingHeadline,
  EXECUTIVE_LABEL,
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
