import {
  routeTaskToAgents,
  buildWorkflowRouting,
  STAGE_TO_OFFICE_INTENT,
  workflowToRow,
  rowToWorkflow,
  auditEventToRow,
  PROGRAM_AGENTS,
  PROGRAM_ROOMS,
  ROOM_BY_KEY,
  roomLabel,
  canRoleApprove,
  type AuditEvent,
  type OfficeWorkflow,
} from "./officeProgram";
import { LIFECYCLE_STAGES } from "@/lib/intelligence";
import {
  addAuditEvent,
  evaluateOfficeTriggers,
  getExecMemory,
  getExecPrecedents,
  getOfficeProgramState,
  hydrateWorkflows,
  OFFICE_TRIGGERS,
  resolveApprovalGate,
  runAutonomousTriggers,
  sceneBus,
  setApprovalDecider,
  setUserRole,
  setWorkflowMode,
  shutdownOfficeProgram,
  submitOfficeTask,
  type ServerApprovalDecider,
  type SceneCommand,
} from "./officeProgramStore";

describe("roomLabel — safe room labels (never crash the floor)", () => {
  it("returns the program label for every office-grid room", () => {
    for (const r of PROGRAM_ROOMS) {
      expect(roomLabel(r.key)).toBe(r.label);
    }
  });

  it("falls back to a prettified label for a key outside ROOM_BY_KEY", () => {
    // A raw ROOM_BY_KEY[key].label access throws for an unknown key — this is
    // the crash that took the whole floor to the error boundary when an agent
    // or workflow referenced a spatial-only / stale room. roomLabel must not.
    const raw = ROOM_BY_KEY as Record<string, { label: string }>;
    expect(() => raw["marketplace"].label).toThrow();
    expect(roomLabel("marketplace")).toBe("Marketplace");
    expect(roomLabel("some_stale_key")).toBe("Some Stale Key");
    expect(roomLabel("executive-advisor")).toBe("Executive Advisor");
    expect(() => roomLabel("marketplace")).not.toThrow();
  });
});

describe("office program task router", () => {
  it("routes data room commands as Tier 2 external-facing across the full floor", () => {
    const r = routeTaskToAgents("Run diligence on the data room");
    expect(r.intent).toBe("data_room_build");
    expect(r.riskTier).toBe("external_facing");
    const agents = r.assignments.map((a) => a.agentId);
    expect(agents).toEqual(
      expect.arrayContaining(["associate", "analyst", "risk", "legal", "investor_relations"])
    );
    expect(r.activeRooms).toEqual(expect.arrayContaining(["trading", "legal", "reception", "boardroom"]));
  });

  it("routes underwriting work as Tier 1 internal", () => {
    const r = routeTaskToAgents("Run an LBO model");
    expect(r.intent).toBe("underwriting");
    expect(r.riskTier).toBe("internal");
    expect(r.assignments.map((a) => a.agentId)).toEqual(
      expect.arrayContaining(["analyst", "principal", "risk"])
    );
  });

  it("routes LP updates as Tier 2 external-facing", () => {
    const r = routeTaskToAgents("Send LP update");
    expect(r.intent).toBe("investor_relations");
    expect(r.riskTier).toBe("external_facing");
  });

  it("routes wires and closings as Tier 3 capital-binding", () => {
    const r = routeTaskToAgents("Prepare closing wires");
    expect(r.intent).toBe("capital_movement");
    expect(r.riskTier).toBe("capital_binding");
    expect(r.assignments.map((a) => a.agentId)).toEqual(
      expect.arrayContaining(["treasury", "legal", "risk"])
    );
  });

  it("never routes silently — unknown input falls back to general execution", () => {
    const r = routeTaskToAgents("xyzzy unclassifiable input");
    expect(r.intent).toBe("general_execution");
    expect(r.assignments.length).toBeGreaterThan(0);
    expect(r.earnPlan.length).toBeGreaterThan(0);
  });

  it("every assignment references a real agent and room", () => {
    const agentIds = new Set(PROGRAM_AGENTS.map((a) => a.id));
    const roomKeys = new Set(PROGRAM_ROOMS.map((r) => r.key));
    for (const cmd of ["data room", "lbo model", "lp update", "closing wires", "compliance queue", "screen target", "kpi review", "misc"]) {
      const r = routeTaskToAgents(cmd);
      for (const a of r.assignments) {
        expect(agentIds.has(a.agentId)).toBe(true);
        expect(roomKeys.has(a.roomKey)).toBe(true);
      }
      for (const room of r.activeRooms) {
        expect(roomKeys.has(room)).toBe(true);
      }
    }
  });

  it("routes IC memo prep to the ic_review workflow", () => {
    const r = routeTaskToAgents("Prepare the IC memo for the committee");
    expect(r.intent).toBe("ic_review");
    expect(r.riskTier).toBe("internal");
    expect(r.title).toContain("IC Memo");
  });

  it("uses the shared intelligence taxonomy — every lifecycle stage maps to a buildable office workflow", () => {
    const agentIds = new Set(PROGRAM_AGENTS.map((a) => a.id));
    const roomKeys = new Set(PROGRAM_ROOMS.map((r) => r.key));
    // STAGE_TO_OFFICE_INTENT must be total over the product's lifecycle stages,
    // and each intent it maps to must build a valid, non-empty workflow.
    for (const stage of LIFECYCLE_STAGES) {
      const intent = STAGE_TO_OFFICE_INTENT[stage];
      expect(intent).toBeDefined();
      const wf = buildWorkflowRouting(intent);
      expect(wf.intent).toBe(intent);
      expect(wf.assignments.length).toBeGreaterThan(0);
      for (const a of wf.assignments) {
        expect(agentIds.has(a.agentId)).toBe(true);
        expect(roomKeys.has(a.roomKey)).toBe(true);
      }
    }
  });

  it("is deterministic — the same command always routes the same way", () => {
    const a = routeTaskToAgents("Run diligence on the data room");
    const b = routeTaskToAgents("Run diligence on the data room");
    expect(a.intent).toBe(b.intent);
    expect(a.riskTier).toBe(b.riskTier);
    expect(a.assignments.map((x) => x.agentId)).toEqual(b.assignments.map((x) => x.agentId));
  });
});

describe("office program — persistence row mappers", () => {
  const workflow: OfficeWorkflow = {
    id: "wf-123",
    title: "Investor-Ready Data Room Build",
    commandText: "Run diligence on the data room",
    intent: "data_room_build",
    mode: "workflow",
    stage: "complete",
    riskTier: "external_facing",
    assignments: [
      { agentId: "associate", roomKey: "trading", owns: "Data Room Index", status: "done", progress: 100, done: true },
      { agentId: "legal", roomKey: "legal", owns: "Document Review", status: "done", progress: 100, done: true },
    ],
    activeRooms: ["ceo", "trading", "legal", "reception", "boardroom"],
    progress: 100,
    etaLabel: "All assigned agents complete",
    currentStep: "Workflow complete and archived",
    nextAction: "None",
    approvalGate: null,
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_050_000,
  };

  it("maps a workflow to its org-scoped persisted row", () => {
    const row = workflowToRow("org-1", workflow, "complete");
    expect(row.organization_id).toBe("org-1");
    expect(row.workflow_key).toBe("wf-123");
    expect(row.intent).toBe("data_room_build");
    expect(row.risk_tier).toBe("external_facing");
    expect(row.assignment_count).toBe(2);
    expect(row.outcome).toBe("complete");
    expect(row.active_rooms).toEqual(["ceo", "trading", "legal", "reception", "boardroom"]);
    expect(row.completed_at).toBe(new Date(1_700_000_050_000).toISOString());
  });

  it("passes a null outcome and a null completion through unchanged", () => {
    const row = workflowToRow("org-1", { ...workflow, completedAt: null }, null);
    expect(row.outcome).toBeNull();
    expect(row.completed_at).toBeNull();
  });

  it("maps an audit event to its append-only row", () => {
    const ev: AuditEvent = {
      id: "aud-9",
      ts: 1_700_000_000_000,
      actor: "Earn",
      action: "Task classified",
      room: "Command Center",
      tier: "external_facing",
      status: "info",
    };
    const row = auditEventToRow("org-2", ev);
    expect(row.organization_id).toBe("org-2");
    expect(row.event_key).toBe("aud-9");
    expect(row.actor).toBe("Earn");
    expect(row.tier).toBe("external_facing");
    expect(row.status).toBe("info");
    expect(row.occurred_at).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe("office program — rowToWorkflow (read-hydrate mapper)", () => {
  const workflow: OfficeWorkflow = {
    id: "wf-123",
    title: "Investor-Ready Data Room Build",
    commandText: "Run diligence on the data room",
    intent: "data_room_build",
    mode: "workflow",
    stage: "complete",
    riskTier: "external_facing",
    assignments: [
      { agentId: "associate", roomKey: "trading", owns: "Data Room Index", status: "done", progress: 100, done: true },
      { agentId: "legal", roomKey: "legal", owns: "Document Review", status: "done", progress: 100, done: true },
    ],
    activeRooms: ["ceo", "trading", "legal", "reception", "boardroom"],
    progress: 100,
    etaLabel: "All assigned agents complete",
    currentStep: "Workflow complete and archived",
    nextAction: "None",
    approvalGate: null,
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_050_000,
  };

  it("reconstructs a workflow from a persisted row", () => {
    const row = workflowToRow("org-1", workflow, "complete");
    const wf = rowToWorkflow(row);
    expect(wf).not.toBeNull();
    expect(wf!.id).toBe("wf-123");
    expect(wf!.title).toBe(workflow.title);
    expect(wf!.intent).toBe("data_room_build");
    expect(wf!.riskTier).toBe("external_facing");
    expect(wf!.stage).toBe("complete");
    expect(wf!.assignments).toHaveLength(2); // rebuilt from assignment_count
    expect(wf!.activeRooms).toEqual(workflow.activeRooms);
    expect(wf!.completedAt).toBe(1_700_000_050_000);
  });

  it("round-trips through workflowToRow: row → workflow → row is stable", () => {
    const row1 = workflowToRow("org-1", workflow, "complete");
    const wf = rowToWorkflow(row1);
    expect(wf).not.toBeNull();
    const row2 = workflowToRow("org-1", wf!, "complete");
    expect(row2).toEqual(row1);
  });

  it("preserves a null completion", () => {
    const row = workflowToRow("org-1", { ...workflow, completedAt: null }, null);
    const wf = rowToWorkflow(row);
    expect(wf!.completedAt).toBeNull();
  });

  it("rejects malformed rows (null, non-object, missing key/title, bad enums)", () => {
    expect(rowToWorkflow(null)).toBeNull();
    expect(rowToWorkflow(undefined)).toBeNull();
    expect(rowToWorkflow(42)).toBeNull();
    expect(rowToWorkflow("nope")).toBeNull();
    expect(rowToWorkflow({})).toBeNull();
    // Missing title.
    expect(rowToWorkflow({ workflow_key: "k", mode: "workflow", stage: "complete", risk_tier: "internal" })).toBeNull();
    // Empty key.
    expect(rowToWorkflow({ workflow_key: "", title: "T", mode: "workflow", stage: "complete", risk_tier: "internal" })).toBeNull();
    // Out-of-range enums.
    expect(rowToWorkflow({ workflow_key: "k", title: "T", mode: "bogus", stage: "complete", risk_tier: "internal" })).toBeNull();
    expect(rowToWorkflow({ workflow_key: "k", title: "T", mode: "workflow", stage: "nope", risk_tier: "internal" })).toBeNull();
    expect(rowToWorkflow({ workflow_key: "k", title: "T", mode: "workflow", stage: "complete", risk_tier: "nope" })).toBeNull();
  });
});

describe("office program — hydrateWorkflows (archive merge)", () => {
  const base: OfficeWorkflow = {
    id: "seed",
    title: "Seed Workflow",
    commandText: "",
    intent: "general_execution",
    mode: "workflow",
    stage: "complete",
    riskTier: "internal",
    assignments: [],
    activeRooms: [],
    progress: 100,
    etaLabel: "",
    currentStep: "",
    nextAction: "",
    approvalGate: null,
    createdAt: 1_800_000_000_000,
    completedAt: 1_800_000_000_000,
  };

  it("is a no-op on an empty array (no state churn)", () => {
    const before = getOfficeProgramState().archive;
    hydrateWorkflows([]);
    expect(getOfficeProgramState().archive).toBe(before); // same reference — no setState
  });

  it("seeds a terminal workflow into the archive", () => {
    hydrateWorkflows([{ ...base, id: "hydrate-seed", title: "Hydrated", stage: "blocked", completedAt: 1_800_000_100_000 }]);
    const entry = getOfficeProgramState().archive.find((a) => a.id === "hydrate-seed");
    expect(entry).toBeDefined();
    expect(entry!.title).toBe("Hydrated");
    expect(entry!.outcome).toBe("rejected"); // stage "blocked" → rejected
  });

  it("dedupes by workflow key — a repeated id is added once", () => {
    const wf = { ...base, id: "hydrate-dupe", completedAt: 1_800_000_200_000 };
    hydrateWorkflows([wf, wf]);
    expect(getOfficeProgramState().archive.filter((a) => a.id === "hydrate-dupe")).toHaveLength(1);
  });

  it("never clobbers an already-known workflow (live/in-memory wins)", () => {
    hydrateWorkflows([{ ...base, id: "keep", title: "Original", stage: "complete", completedAt: 1_800_000_300_000 }]);
    // A later, stale persisted row for the same key must not overwrite it.
    hydrateWorkflows([{ ...base, id: "keep", title: "Stale Overwrite", stage: "blocked", completedAt: 1_800_000_400_000 }]);
    const entry = getOfficeProgramState().archive.find((a) => a.id === "keep");
    expect(entry!.title).toBe("Original");
    expect(entry!.outcome).toBe("complete");
  });

  it("ignores in-flight (non-terminal) rows — only terminal workflows seed the archive", () => {
    const before = getOfficeProgramState().archive.length;
    hydrateWorkflows([{ ...base, id: "inflight", completedAt: null }]);
    expect(getOfficeProgramState().archive.length).toBe(before);
  });
});

describe("office program workflow simulation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    shutdownOfficeProgram();
    jest.useRealTimers();
  });

  it("runs the investor-ready data room build end to end with a Tier 2 gate", () => {
    const sceneCommands: SceneCommand[] = [];
    const unsub = sceneBus.on((cmd) => sceneCommands.push(cmd));

    setWorkflowMode("workflow");
    submitOfficeTask("Run diligence on the data room");

    // Earn classifies immediately — office leaves the calm state.
    let s = getOfficeProgramState();
    expect(s.officeStatus).toBe("planning");
    expect(s.agents.earn.state).toBe("classifying");
    expect(s.audit.some((e) => e.action.includes("Command submitted"))).toBe(true);

    // Let classification, assignment, movement, and progress run.
    jest.advanceTimersByTime(60_000);

    s = getOfficeProgramState();
    expect(s.activeWorkflow?.stage).toBe("approval");
    expect(s.officeStatus).toBe("awaiting_approval");
    const gate = s.approvals.find((g) => g.status === "pending");
    expect(gate?.tier).toBe("external_facing");

    // Every assigned agent produced its output.
    expect(s.activeWorkflow?.assignments.every((a) => a.done)).toBe(true);
    expect(s.activeWorkflow?.progress).toBe(100);

    // NPC reactivity: agents moved and rooms activated via the scene bus.
    expect(sceneCommands.some((c) => c.type === "npc-goto" && c.agentId === "associate")).toBe(true);
    expect(sceneCommands.some((c) => c.type === "room-activity" && c.roomKey === "reception" && c.active)).toBe(true);
    expect(sceneCommands.some((c) => c.type === "handoff")).toBe(true);

    // User approves the Tier 2 gate → workflow archives and the office calms.
    resolveApprovalGate(gate!.id, "approved");
    jest.advanceTimersByTime(10_000);

    s = getOfficeProgramState();
    expect(s.activeWorkflow).toBeNull();
    expect(s.archive[0]?.outcome).toBe("complete");
    expect(s.officeStatus).toBe("calm");
    expect(s.agents.associate.state).toBe("idle");
    expect(s.audit.some((e) => e.action.includes("Approval granted"))).toBe(true);
    expect(s.audit.some((e) => e.action.includes("Workflow archived"))).toBe(true);

    unsub();
  });

  it("blocks unauthorized roles from clearing a capital-binding gate", () => {
    setWorkflowMode("workflow");
    setUserRole("analyst"); // not authorized for any approval tier
    submitOfficeTask("Prepare closing wires"); // Tier 3 capital-binding
    jest.advanceTimersByTime(60_000);

    let s = getOfficeProgramState();
    const gate = s.approvals.find((g) => g.status === "pending");
    expect(gate?.tier).toBe("capital_binding");

    // Analyst cannot approve — the gate stays pending, no archive.
    resolveApprovalGate(gate!.id, "approved");
    jest.advanceTimersByTime(5_000);
    s = getOfficeProgramState();
    expect(s.approvals.find((g) => g.id === gate!.id)?.status).toBe("pending");
    expect(s.activeWorkflow).not.toBeNull();
    expect(s.audit.some((e) => e.action.includes("Approval blocked"))).toBe(true);

    // A Managing Partner can clear it → workflow completes.
    setUserRole("managing_partner");
    resolveApprovalGate(gate!.id, "approved");
    jest.advanceTimersByTime(10_000);
    s = getOfficeProgramState();
    expect(s.activeWorkflow).toBeNull();
    expect(s.archive[0]?.outcome).toBe("complete");

    setUserRole("managing_partner"); // restore default for other tests
  });

  it("encodes the tier authorization matrix", () => {
    expect(canRoleApprove("managing_partner", "capital_binding")).toBe(true);
    expect(canRoleApprove("compliance", "capital_binding")).toBe(true);
    expect(canRoleApprove("principal", "capital_binding")).toBe(false);
    expect(canRoleApprove("principal", "external_facing")).toBe(true);
    expect(canRoleApprove("analyst", "external_facing")).toBe(false);
    expect(canRoleApprove("observer", "external_facing")).toBe(false);
  });

  it("keeps conversation mode free of autonomous work", () => {
    setUserRole("managing_partner");
    setWorkflowMode("conversation");
    const before = getOfficeProgramState().archive.length;
    submitOfficeTask("Build investor-ready data room");
    jest.advanceTimersByTime(30_000);
    const s = getOfficeProgramState();
    expect(s.activeWorkflow).toBeNull();
    expect(s.archive.length).toBe(before);
    expect(s.approvals.filter((g) => g.status === "pending")).toHaveLength(0);
  });
});

describe("office program — server-side approval authority", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setUserRole("managing_partner");
  });

  afterEach(() => {
    setApprovalDecider(null);
    shutdownOfficeProgram();
    jest.useRealTimers();
  });

  it("defers to the server decider and blocks an unauthorized approval", async () => {
    const calls: Array<{ tier: string; decision: string }> = [];
    let allow = false;
    const decider: ServerApprovalDecider = async ({ tier, decision }) => {
      calls.push({ tier, decision });
      return decision === "approved" && !allow
        ? { ok: false, error: "not authorized to approve capital_binding actions" }
        : { ok: true };
    };
    setApprovalDecider(decider);

    setWorkflowMode("workflow");
    submitOfficeTask("Prepare closing wires"); // Tier 3 capital-binding
    jest.advanceTimersByTime(60_000);

    let s = getOfficeProgramState();
    const gate = s.approvals.find((g) => g.status === "pending");
    expect(gate?.tier).toBe("capital_binding");

    // Server denies → gate stays pending, workflow still active, audit records it.
    await resolveApprovalGate(gate!.id, "approved");
    jest.advanceTimersByTime(5_000);
    s = getOfficeProgramState();
    expect(s.approvals.find((g) => g.id === gate!.id)?.status).toBe("pending");
    expect(s.activeWorkflow).not.toBeNull();
    expect(s.audit.some((e) => e.action.includes("Approval blocked by server"))).toBe(true);
    expect(calls).toContainEqual({ tier: "capital_binding", decision: "approved" });

    // Server now authorizes → workflow completes and archives.
    allow = true;
    await resolveApprovalGate(gate!.id, "approved");
    jest.advanceTimersByTime(10_000);
    s = getOfficeProgramState();
    expect(s.activeWorkflow).toBeNull();
    expect(s.archive[0]?.outcome).toBe("complete");
    expect(s.audit.some((e) => e.action.includes("server-verified"))).toBe(true);
  });

  it("never lets a server error block a rejection (halt always proceeds)", async () => {
    const decider: ServerApprovalDecider = async () => {
      throw new Error("network down");
    };
    setApprovalDecider(decider);

    setWorkflowMode("workflow");
    submitOfficeTask("Draft LP update"); // Tier 2 external-facing
    jest.advanceTimersByTime(60_000);

    let s = getOfficeProgramState();
    const gate = s.approvals.find((g) => g.status === "pending");
    expect(gate?.tier).toBe("external_facing");

    await resolveApprovalGate(gate!.id, "rejected");
    jest.advanceTimersByTime(10_000);
    s = getOfficeProgramState();
    expect(s.activeWorkflow).toBeNull();
    expect(s.archive[0]?.outcome).toBe("rejected");
  });
});

describe("office program — per-exec memory & precedent recall", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setUserRole("managing_partner");
    setWorkflowMode("workflow");
  });

  afterEach(() => {
    shutdownOfficeProgram();
    jest.useRealTimers();
  });

  it("derives precedents from completed per-agent outputs in the audit log", () => {
    addAuditEvent({ actor: "Portfolio Ops", action: "Output completed — KPI Board", room: "Portfolio Ops", tier: "internal", status: "complete" });
    // Non-output completions and non-executive actors never become precedents.
    addAuditEvent({ actor: "Earn", action: "Workflow archived — Portfolio Operations Review", room: "Command Center", tier: "internal", status: "complete" });
    addAuditEvent({ actor: "Portfolio Ops", action: "Refreshing KPI dashboards", room: "Portfolio Ops", tier: "internal", status: "info" });

    const precedents = getExecPrecedents("portfolio_ops");
    const kpi = precedents.find((p) => p.label === "KPI Board");
    expect(kpi).toBeDefined();
    expect(kpi!.execId).toBe("portfolio_ops");
    expect(kpi!.outcome).toBe("complete");
    expect(kpi!.auditEventId).toMatch(/^aud-/);

    // Memory is keyed by exec id and never invents history for other execs.
    const memory = getExecMemory();
    expect(memory.portfolio_ops?.some((p) => p.label === "KPI Board")).toBe(true);
    expect((memory.earn ?? []).some((p) => p.label.includes("Workflow"))).toBe(false);
  });

  it("recalls a prior mandate when the same exec is re-assigned a similar deliverable", () => {
    // First portfolio review ships the KPI board (Tier 1 → no gate, auto-completes).
    submitOfficeTask("Portfolio operations review");
    jest.advanceTimersByTime(60_000);
    expect(getOfficeProgramState().activeWorkflow).toBeNull();
    expect(getExecPrecedents("portfolio_ops").some((p) => p.label === "KPI Board")).toBe(true);

    // Second identical mandate: Portfolio Ops should recall the precedent at assignment.
    submitOfficeTask("Portfolio operations review");
    jest.advanceTimersByTime(3_000); // reach the assignment step
    const s = getOfficeProgramState();
    expect(s.audit.some((e) => e.actor === "Portfolio Ops" && e.action.startsWith("Precedent recalled"))).toBe(true);
    expect(s.chat.some((m) => m.author === "Portfolio Ops" && m.text.includes("similar mandate"))).toBe(true);

    jest.advanceTimersByTime(60_000); // let it finish and calm the office
  });
});

describe("office program — autonomous triggers", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setUserRole("managing_partner");
    setWorkflowMode("workflow");
  });

  afterEach(() => {
    shutdownOfficeProgram();
    jest.useRealTimers();
  });

  it("exposes the portfolio recurring-review trigger", () => {
    const t = OFFICE_TRIGGERS.find((x) => x.id === "portfolio-ops-recurring-review");
    expect(t?.execId).toBe("portfolio_ops");
    expect(t?.condition.kind).toBe("recurring_review");
  });

  it("does not self-start when no recurring review has come due", () => {
    // A fresh KPI shipment means the review is NOT yet due at the current clock.
    addAuditEvent({ actor: "Portfolio Ops", action: "Output completed — KPI Board", room: "Portfolio Ops", tier: "internal", status: "complete" });
    expect(evaluateOfficeTriggers()).toEqual([]);
    expect(runAutonomousTriggers()).toBeNull();
    expect(getOfficeProgramState().activeWorkflow).toBeNull();
  });

  it("lets Portfolio Ops proactively initiate a review once the last one is stale", () => {
    addAuditEvent({ actor: "Portfolio Ops", action: "Output completed — KPI Board", room: "Portfolio Ops", tier: "internal", status: "complete" });
    const due = Date.now() + 7 * 60 * 60 * 1000; // past the 6h interval

    // Conversation mode never self-starts.
    setWorkflowMode("conversation");
    expect(runAutonomousTriggers(due)).toBeNull();
    expect(getOfficeProgramState().activeWorkflow).toBeNull();

    // In an executing mode the trigger fires and routes through normal intake.
    setWorkflowMode("workflow");
    const firedId = runAutonomousTriggers(due);
    expect(firedId).toBe("portfolio-ops-recurring-review");
    let s = getOfficeProgramState();
    expect(s.audit.some((e) => e.actor === "Portfolio Ops" && e.action.startsWith("Autonomous trigger fired"))).toBe(true);

    jest.advanceTimersByTime(2_000); // classify → execute
    s = getOfficeProgramState();
    expect(s.activeWorkflow).not.toBeNull();
    expect(s.activeWorkflow?.intent).toBe("portfolio_ops");
  });
});
