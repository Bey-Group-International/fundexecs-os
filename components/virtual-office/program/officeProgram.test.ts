import { routeTaskToAgents, PROGRAM_AGENTS, PROGRAM_ROOMS, canRoleApprove } from "./officeProgram";
import {
  getOfficeProgramState,
  resolveApprovalGate,
  sceneBus,
  setUserRole,
  setWorkflowMode,
  shutdownOfficeProgram,
  submitOfficeTask,
  type SceneCommand,
} from "./officeProgramStore";

describe("office program task router", () => {
  it("routes data room commands as Tier 2 external-facing across the full floor", () => {
    const r = routeTaskToAgents("Build investor-ready data room");
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
    submitOfficeTask("Build investor-ready data room");

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
