/**
 * FundExecs OS — Office Program store.
 *
 * A dependency-free singleton store that runs the institutional office:
 * command intake, task routing, agent state, room activation, approval
 * gates, meetings, and the audit trail. The React layer subscribes via
 * useSyncExternalStore; the Phaser scene subscribes to `sceneBus` for
 * visual commands (agent movement, room activity, handoffs).
 *
 * Everything here is a visual workflow simulation with clean seams for
 * real backend integration:
 *  - TODO(supabase): persist workflows / audit events per fund workspace.
 *  - TODO(websocket): drive stage transitions from the workflow engine
 *    instead of local timers (VirtualOfficeSocket already carries NPC state).
 *  - TODO(earn-backend): swap routeTaskToAgents for the real classifier.
 *  - TODO(permissions): approval actions must check the caller's role.
 */

import {
  AGENT_BY_ID,
  MEETING_TYPES,
  PROGRAM_AGENTS,
  PROGRAM_ROOMS,
  ROLE_LABELS,
  ROOM_BY_KEY,
  STAGE_ORDER,
  canRoleApprove,
  rolesForTier,
  routeTaskToAgents,
  type ActiveMeeting,
  type AgentAssignment,
  type AgentId,
  type AgentState,
  type ApprovalGate,
  type AuditEvent,
  type ChatKind,
  type ChatMessage,
  type MeetingType,
  type OfficeRole,
  type OfficeWorkflow,
  type RiskTier,
  type RoomKey,
  type RoutingResult,
  type WorkflowMode,
  type WorkflowStage,
} from "./officeProgram";

// ─── Scene command bus ───────────────────────────────────────────────────────
// The Phaser scene cannot import React state; it listens to this bus and
// translates commands into avatar movement and room visuals.

export type SceneCommand =
  | { type: "npc-goto"; agentId: AgentId; roomKey: RoomKey }
  | { type: "npc-state"; agentId: AgentId; state: AgentState; label: string }
  | { type: "room-activity"; roomKey: RoomKey; active: boolean; taskCount: number; tier: RiskTier | null }
  | { type: "handoff"; toAgentId: AgentId };

type SceneListener = (cmd: SceneCommand) => void;

const sceneListeners = new Set<SceneListener>();

export const sceneBus = {
  on(fn: SceneListener): () => void {
    sceneListeners.add(fn);
    return () => sceneListeners.delete(fn);
  },
  emit(cmd: SceneCommand) {
    for (const fn of sceneListeners) fn(cmd);
  },
};

// ─── State shape ─────────────────────────────────────────────────────────────

export type AgentRuntime = {
  id: AgentId;
  state: AgentState;
  roomKey: RoomKey;
  /** Executive status line — specific, never "Working…". */
  statusLabel: string;
  /** Deliverable currently owned (ownership badge), if assigned. */
  owns: string | null;
  progress: number;
  /** 0–3 rough workload indicator. */
  workload: number;
};

export type RoomRuntime = {
  key: RoomKey;
  active: boolean;
  taskCount: number;
  tier: RiskTier | null;
  /** Names of agents currently working in the room. */
  activeAgents: AgentId[];
};

export type ArchivedWorkflow = {
  id: string;
  title: string;
  riskTier: RiskTier;
  outcome: "complete" | "rejected";
  completedAt: number;
};

/** Copilot mode: a generated plan waiting for the user's go-ahead. */
export type PendingPlan = {
  commandText: string;
  routing: RoutingResult;
};

export type OfficeProgramState = {
  mode: WorkflowMode;
  /** The signed-in user's role — gates which approval tiers they can clear. */
  userRole: OfficeRole;
  officeStatus: "calm" | "planning" | "executing" | "awaiting_approval";
  agents: Record<AgentId, AgentRuntime>;
  rooms: Record<RoomKey, RoomRuntime>;
  activeWorkflow: OfficeWorkflow | null;
  pendingPlan: PendingPlan | null;
  queuedCommands: string[];
  approvals: ApprovalGate[];
  audit: AuditEvent[];
  chat: ChatMessage[];
  archive: ArchivedWorkflow[];
  meeting: ActiveMeeting | null;
  /** Plain-language "What's happening now" summary for the confidence layer. */
  happeningNow: string;
};

function initialAgents(): Record<AgentId, AgentRuntime> {
  const out = {} as Record<AgentId, AgentRuntime>;
  for (const a of PROGRAM_AGENTS) {
    out[a.id] = {
      id: a.id,
      state: "idle",
      roomKey: a.homeRoom,
      statusLabel: a.role,
      owns: null,
      progress: 0,
      workload: 0,
    };
  }
  return out;
}

function initialRooms(): Record<RoomKey, RoomRuntime> {
  const out = {} as Record<RoomKey, RoomRuntime>;
  for (const r of PROGRAM_ROOMS) {
    out[r.key] = { key: r.key, active: false, taskCount: 0, tier: null, activeAgents: [] };
  }
  return out;
}

let state: OfficeProgramState = {
  mode: "copilot",
  userRole: "managing_partner",
  officeStatus: "calm",
  agents: initialAgents(),
  rooms: initialRooms(),
  activeWorkflow: null,
  pendingPlan: null,
  queuedCommands: [],
  approvals: [],
  audit: [],
  chat: [
    {
      id: "welcome",
      ts: Date.now(),
      kind: "earn",
      author: "Earn",
      text: "Office online. All executive agents are idle and no approvals are open. Give me a command or pick a suggested workflow.",
    },
  ],
  archive: [],
  meeting: null,
  happeningNow: "The office is calm. Earn is available, all agents are online, and there are no open approvals.",
};

// ─── Subscription plumbing ───────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOfficeProgram(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getOfficeProgramState(): OfficeProgramState {
  return state;
}

function setState(patch: Partial<OfficeProgramState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

// ─── Timers ──────────────────────────────────────────────────────────────────
// All simulation timers are tracked so a workflow can be cancelled cleanly
// and so hot reloads don't leak intervals.

let timers: Array<ReturnType<typeof setTimeout>> = [];
let progressTicker: ReturnType<typeof setInterval> | null = null;

function after(ms: number, fn: () => void) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function clearWorkflowTimers() {
  for (const id of timers) clearTimeout(id);
  timers = [];
  if (progressTicker) {
    clearInterval(progressTicker);
    progressTicker = null;
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const MAX_LOG = 200;

function pushChat(kind: ChatKind, author: string, text: string) {
  const msg: ChatMessage = { id: nextId("msg"), ts: Date.now(), kind, author, text };
  setState({ chat: [...state.chat, msg].slice(-MAX_LOG) });
}

/**
 * Append an audit event. This log is the institutional record of every
 * command, assignment, gate, and completion.
 * TODO(supabase): mirror into the audit database (append-only table).
 */
export function addAuditEvent(ev: Omit<AuditEvent, "id" | "ts">) {
  const event: AuditEvent = { ...ev, id: nextId("aud"), ts: Date.now() };
  setState({ audit: [...state.audit, event].slice(-MAX_LOG) });
}

function patchAgent(agentId: AgentId, patch: Partial<AgentRuntime>) {
  setState({ agents: { ...state.agents, [agentId]: { ...state.agents[agentId], ...patch } } });
}

function patchRoom(roomKey: RoomKey, patch: Partial<RoomRuntime>) {
  setState({ rooms: { ...state.rooms, [roomKey]: { ...state.rooms[roomKey], ...patch } } });
}

/** Update an agent's program state and mirror it to the scene avatar. */
export function updateNPCState(agentId: AgentId, agentState: AgentState, label: string) {
  patchAgent(agentId, { state: agentState, statusLabel: label });
  sceneBus.emit({ type: "npc-state", agentId, state: agentState, label });
}

/** Walk an agent's avatar to a room and track its logical location. */
export function moveNPCToRoom(agentId: AgentId, roomKey: RoomKey) {
  patchAgent(agentId, { roomKey });
  sceneBus.emit({ type: "npc-goto", agentId, roomKey });
}

/** Activate/deactivate a room's overlay (glow, task count, tier badge). */
export function triggerRoomActivity(roomKey: RoomKey, active: boolean, taskCount: number, tier: RiskTier | null, activeAgents: AgentId[]) {
  patchRoom(roomKey, { active, taskCount, tier, activeAgents });
  sceneBus.emit({ type: "room-activity", roomKey, active, taskCount, tier });
}

function activateRooms(roomKeys: RoomKey[], assignments: AgentAssignment[], tier: RiskTier) {
  for (const key of roomKeys) {
    const inRoom = assignments.filter((a) => a.roomKey === key).map((a) => a.agentId);
    triggerRoomActivity(key, true, inRoom.length || (key === "ceo" || key === "boardroom" ? 1 : 0), tier, inRoom);
  }
}

function deactivateAllRooms() {
  for (const r of PROGRAM_ROOMS) triggerRoomActivity(r.key, false, 0, null, []);
}

function workflowProgress(wf: OfficeWorkflow): number {
  if (wf.assignments.length === 0) return 0;
  const total = wf.assignments.reduce((s, a) => s + a.progress, 0);
  return Math.round(total / wf.assignments.length);
}

function patchWorkflow(patch: Partial<OfficeWorkflow>) {
  if (!state.activeWorkflow) return;
  setState({ activeWorkflow: { ...state.activeWorkflow, ...patch } });
}

function setStage(stage: WorkflowStage, currentStep: string, nextAction: string, etaLabel?: string) {
  patchWorkflow({ stage, currentStep, nextAction, ...(etaLabel ? { etaLabel } : {}) });
}

// ─── Modes ───────────────────────────────────────────────────────────────────

export function setWorkflowMode(mode: WorkflowMode) {
  setState({ mode });
  addAuditEvent({ actor: "You", action: `Workflow mode set to ${mode}`, room: "Command Center", tier: null, status: "info" });
}

/**
 * Set the signed-in user's role. Called from the React layer with the
 * value from session metadata; determines which approval tiers the user
 * can clear.
 */
export function setUserRole(role: OfficeRole) {
  if (state.userRole === role) return;
  setState({ userRole: role });
}

/** Whether the current user may clear the given (non-internal) tier. */
export function canApproveTier(tier: Exclude<RiskTier, "internal">): boolean {
  return canRoleApprove(state.userRole, tier);
}

// ─── Command intake ──────────────────────────────────────────────────────────

/**
 * Entry point for every user command. No task is processed silently:
 * Earn always reacts, classifies, and routes with visible office activity.
 */
export function submitOfficeTask(taskText: string) {
  const text = taskText.trim();
  if (!text) return;

  pushChat("user_command", "You", text);
  addAuditEvent({ actor: "You", action: `Command submitted: "${text}"`, room: "Command Center", tier: null, status: "info" });

  if (state.mode === "conversation") {
    // Conversation mode: Earn responds, no autonomous work begins.
    const routing = routeTaskToAgents(text);
    updateNPCState("earn", "listening", "Listening");
    after(500, () => {
      pushChat(
        "earn",
        "Earn",
        `Conversation mode — I won't start autonomous work. If you switch to Copilot or Workflow mode, I would classify this as "${routing.title}" and route ${routing.assignments.length} agent${routing.assignments.length === 1 ? "" : "s"} across ${routing.activeRooms.length} rooms at ${tierLabel(routing.riskTier)}.`
      );
      updateNPCState("earn", "idle", "AI Command Operator");
    });
    return;
  }

  if (state.activeWorkflow) {
    setState({ queuedCommands: [...state.queuedCommands, text] });
    pushChat("earn", "Earn", `"${state.activeWorkflow.title}" is still in flight. I've queued this command and will route it as soon as the current workflow clears.`);
    addAuditEvent({ actor: "Earn", action: "Command queued behind active workflow", room: "Command Center", tier: null, status: "pending" });
    return;
  }

  classifyAndRoute(text);
}

function tierLabel(tier: RiskTier): string {
  return tier === "internal" ? "Tier 1 (internal)" : tier === "external_facing" ? "Tier 2 (external-facing)" : "Tier 3 (capital-binding)";
}

/** Step 1 — Earn reacts: classify, announce the plan, then assign or wait. */
function classifyAndRoute(text: string) {
  const routing = routeTaskToAgents(text);

  setState({ officeStatus: "planning", happeningNow: "Earn is classifying the task and preparing an execution plan." });
  updateNPCState("earn", "classifying", "Classifying task");
  triggerRoomActivity("ceo", true, 1, routing.riskTier, ["earn"]);
  addAuditEvent({ actor: "Earn", action: `Task classified as ${routing.title}`, room: "Command Center", tier: routing.riskTier, status: "info" });

  after(800, () => {
    pushChat("earn", "Earn", routing.earnPlan);
    addAuditEvent({ actor: "Earn", action: "Execution plan generated", room: "Command Center", tier: routing.riskTier, status: "info" });

    if (state.mode === "copilot") {
      // Copilot: Earn proposes, the user approves the plan before execution.
      setState({
        pendingPlan: { commandText: text, routing },
        happeningNow: `Earn has planned "${routing.title}" and is waiting for you to approve the plan before any agent starts work.`,
      });
      updateNPCState("earn", "listening", "Awaiting plan approval");
      pushChat("system", "Office", "Copilot mode: approve the plan in the Active Work panel to begin execution.");
      addAuditEvent({ actor: "Earn", action: "Plan awaiting user approval (copilot mode)", room: "Command Center", tier: routing.riskTier, status: "pending" });
      return;
    }

    startExecution(text, routing);
  });
}

/** Copilot: the user approved Earn's proposed plan. */
export function approvePendingPlan() {
  const plan = state.pendingPlan;
  if (!plan) return;
  setState({ pendingPlan: null });
  addAuditEvent({ actor: "You", action: "Execution plan approved", room: "Command Center", tier: plan.routing.riskTier, status: "approved" });
  startExecution(plan.commandText, plan.routing);
}

/** Copilot: the user declined Earn's proposed plan. */
export function dismissPendingPlan() {
  const plan = state.pendingPlan;
  if (!plan) return;
  setState({ pendingPlan: null, officeStatus: "calm", happeningNow: "Plan dismissed. The office is calm and Earn is available." });
  updateNPCState("earn", "idle", "AI Command Operator");
  triggerRoomActivity("ceo", false, 0, null, []);
  pushChat("earn", "Earn", "Understood — plan dismissed. Nothing was routed.");
  addAuditEvent({ actor: "You", action: "Execution plan dismissed", room: "Command Center", tier: plan.routing.riskTier, status: "rejected" });
}

// ─── Execution engine ────────────────────────────────────────────────────────

/** Steps 2–4 — assign agents, move them, and start role-specific work. */
function startExecution(commandText: string, routing: RoutingResult) {
  const workflow: OfficeWorkflow = {
    id: nextId("wf"),
    title: routing.title,
    commandText,
    intent: routing.intent,
    mode: state.mode,
    stage: "planned",
    riskTier: routing.riskTier,
    assignments: routing.assignments.map((a) => ({ ...a, progress: 0, done: false })),
    activeRooms: routing.activeRooms,
    progress: 0,
    etaLabel: `${routing.assignments.length + 2} workflow steps remaining`,
    currentStep: "Earn is delegating work to the executive team",
    nextAction: "None — Earn is routing the work",
    approvalGate: null,
    createdAt: Date.now(),
    completedAt: null,
  };

  setState({
    activeWorkflow: workflow,
    officeStatus: "executing",
    happeningNow: `Earn has delegated "${routing.title}" to ${routing.assignments.length} executive agent${routing.assignments.length === 1 ? "" : "s"}.`,
  });
  updateNPCState("earn", "assigned", "Routing work to agents");

  assignTaskToNPCs(workflow);
}

/** Step 2 — visible handoff: task cards travel from Earn to each agent. */
function assignTaskToNPCs(workflow: OfficeWorkflow) {
  setStage("assigned", "Task cards are being handed to the assigned agents", "None — agents are receiving assignments");
  activateRooms(workflow.activeRooms, workflow.assignments, workflow.riskTier);

  workflow.assignments.forEach((a, i) => {
    after(300 + i * 260, () => {
      const agent = AGENT_BY_ID[a.agentId];
      sceneBus.emit({ type: "handoff", toAgentId: a.agentId });
      patchAgent(a.agentId, { owns: a.owns, progress: 0, workload: 1 });
      updateNPCState(a.agentId, "assigned", `Assigned: ${a.owns}`);
      addAuditEvent({
        actor: "Earn",
        action: `${agent.name} assigned — ${a.owns}`,
        room: ROOM_BY_KEY[a.roomKey].label,
        tier: workflow.riskTier,
        status: "info",
      });
    });
  });

  // Step 3 — agents move with purpose to their rooms.
  after(300 + workflow.assignments.length * 260 + 500, () => {
    setStage("in_progress", "Agents are moving to their rooms and starting first-pass outputs", "None — the team is executing");
    for (const a of workflow.assignments) {
      updateNPCState(a.agentId, "moving", `Heading to ${ROOM_BY_KEY[a.roomKey].label}`);
      moveNPCToRoom(a.agentId, a.roomKey);
    }
    pushChat("earn", "Earn", `The team is on the floor: ${workflow.assignments.map((a) => AGENT_BY_ID[a.agentId].name).join(", ")}. I'll report as outputs land.`);

    // Step 4 — arrive and work.
    after(1400, () => {
      for (const a of workflow.assignments) {
        updateNPCState(a.agentId, "working", a.status);
      }
      startProgressTicker();
    });
  });
}

/** Step 4→5 — progress ticks per agent until every assignment is done. */
function startProgressTicker() {
  if (progressTicker) clearInterval(progressTicker);
  progressTicker = setInterval(() => {
    const wf = state.activeWorkflow;
    if (!wf || wf.stage !== "in_progress") return;

    let changed = false;
    const assignments = wf.assignments.map((a) => {
      if (a.done) return a;
      changed = true;
      const bump = 9 + Math.random() * 14;
      const progress = Math.min(100, a.progress + bump);
      const done = progress >= 100;
      patchAgent(a.agentId, { progress: Math.round(progress) });
      if (done) {
        const agent = AGENT_BY_ID[a.agentId];
        updateNPCState(a.agentId, "complete", `${a.owns} ready for review`);
        pushChat("agent_update", agent.name, `${a.owns} is ready for review.`);
        addAuditEvent({ actor: agent.name, action: `Output completed — ${a.owns}`, room: ROOM_BY_KEY[a.roomKey].label, tier: wf.riskTier, status: "complete" });
      }
      return { ...a, progress: Math.round(progress), done };
    });

    if (!changed) return;

    const wfNow = state.activeWorkflow;
    if (!wfNow) return;
    const remaining = assignments.filter((a) => !a.done).length;
    setState({
      activeWorkflow: {
        ...wfNow,
        assignments,
        progress: workflowProgress({ ...wfNow, assignments }),
        etaLabel: remaining > 0 ? `${remaining} agent output${remaining === 1 ? "" : "s"} remaining` : "Ready for Boardroom review",
      },
      happeningNow: describeExecution(assignments),
    });

    if (remaining === 0) {
      if (progressTicker) { clearInterval(progressTicker); progressTicker = null; }
      after(700, () => enterReview());
    }
  }, 650);
}

function describeExecution(assignments: AgentAssignment[]): string {
  const working = assignments.filter((a) => !a.done);
  if (working.length === 0) return "All assigned agents are complete. Outputs are moving to the Boardroom.";
  const lines = working.slice(0, 3).map((a) => `${AGENT_BY_ID[a.agentId].name} — ${a.status.toLowerCase()}`);
  return `${lines.join(". ")}.`;
}

/** Step 5 — outputs route to the Boardroom for review. */
function enterReview() {
  const wf = state.activeWorkflow;
  if (!wf) return;

  setStage("review", "Boardroom review of all agent outputs", "None — Principal is reviewing", "1 review step remaining");
  setState({ happeningNow: "Outputs have moved to the Boardroom. The Principal is reviewing before anything is finalized." });
  triggerRoomActivity("boardroom", true, 1, wf.riskTier, ["principal"]);
  updateNPCState("principal", "reviewing", "Reviewing outputs in the Boardroom");
  moveNPCToRoom("principal", "boardroom");
  addAuditEvent({ actor: "Principal", action: "Boardroom review started", room: "Boardroom", tier: wf.riskTier, status: "info" });

  after(1900, () => {
    if (wf.riskTier === "internal") {
      completeOfficeTask("approved");
    } else {
      surfaceApprovalGate();
    }
  });
}

/** Step 5b — Tier 2/3 work stops at an explicit approval gate. */
function surfaceApprovalGate() {
  const wf = state.activeWorkflow;
  if (!wf || wf.riskTier === "internal") return;

  const gate = createApprovalGate(wf.id, wf.title, wf.riskTier);
  patchWorkflow({ approvalGate: gate });
  setStage(
    "approval",
    "Boardroom review is complete. The approval gate is open.",
    wf.riskTier === "capital_binding"
      ? "Tier 3 capital-binding approval — nothing moves without you"
      : "Tier 2 external-facing approval required",
    "Approval required before finalization"
  );
  setState({
    officeStatus: "awaiting_approval",
    happeningNow:
      wf.riskTier === "capital_binding"
        ? "All preparation is done. This is capital-binding work, so it is locked until you explicitly approve it."
        : "Boardroom review is complete. Tier 2 approval is waiting for you before anything external-facing is finalized.",
  });

  updateNPCState("risk", "waiting_for_approval", "Holding at the approval gate");
  moveNPCToRoom("risk", "boardroom");
  pushChat(
    "approval",
    "Risk & Compliance",
    wf.riskTier === "capital_binding"
      ? `Tier 3 gate: "${wf.title}" involves capital-binding actions. Explicit approval is required — this is never automated.`
      : `Tier 2 gate: "${wf.title}" produces external-facing materials. Approve to finalize or reject to send it back.`
  );
}

/**
 * Create a pending approval gate for the active workflow.
 * TODO(permissions): the backend must verify the approver's role here.
 */
export function createApprovalGate(workflowId: string, title: string, tier: Exclude<RiskTier, "internal">): ApprovalGate {
  const gate: ApprovalGate = {
    id: nextId("gate"),
    workflowId,
    title: tier === "capital_binding" ? `Capital-binding approval — ${title}` : `External-facing approval — ${title}`,
    tier,
    status: "pending",
    requiredBy: "risk",
    roomKey: "boardroom",
    reason:
      tier === "capital_binding"
        ? "Subscription docs, wires, and closing actions bind capital and require explicit user approval."
        : "Investor-facing materials must be approved before they leave the firm.",
  };
  setState({ approvals: [...state.approvals, gate] });
  addAuditEvent({ actor: "Risk & Compliance", action: `Approval required — ${gate.title}`, room: "Boardroom", tier, status: "pending" });
  return gate;
}

/** User decision on the open approval gate. */
export function resolveApprovalGate(gateId: string, decision: "approved" | "rejected") {
  const gate = state.approvals.find((g) => g.id === gateId);
  if (!gate || gate.status !== "pending") return;

  // Role enforcement: capital-binding and external-facing approvals may only
  // be granted by authorized roles. Anyone may reject (halt) a gate.
  //
  // SECURITY BOUNDARY: this is a client-side UX gate over a visual
  // simulation — it is NOT a security control. Before any real
  // external-facing or capital-binding action is wired up, the approval
  // authority MUST be re-checked server-side (Supabase RLS / the role-based
  // permission system). Never treat this branch as the sole guard on a
  // privileged action. See TODO(permissions) on OfficeRole and
  // createApprovalGate.
  if (decision === "approved" && !canRoleApprove(state.userRole, gate.tier)) {
    pushChat(
      "approval",
      "Risk & Compliance",
      `Your role (${ROLE_LABELS[state.userRole]}) is not authorized to approve this ${gate.tier === "capital_binding" ? "capital-binding" : "external-facing"} gate. Requires ${rolesForTier(gate.tier)}.`
    );
    addAuditEvent({
      actor: "You",
      action: `Approval blocked — ${ROLE_LABELS[state.userRole]} not authorized for ${gate.title}`,
      room: "Boardroom",
      tier: gate.tier,
      status: "rejected",
    });
    return;
  }

  setState({ approvals: state.approvals.map((g) => (g.id === gateId ? { ...g, status: decision } : g)) });
  addAuditEvent({
    actor: "You",
    action: decision === "approved" ? `Approval granted — ${gate.title}` : `Approval rejected — ${gate.title}`,
    room: "Boardroom",
    tier: gate.tier,
    status: decision,
  });

  if (state.activeWorkflow?.id === gate.workflowId) {
    patchWorkflow({ approvalGate: { ...gate, status: decision } });
    completeOfficeTask(decision);
  }
}

/** Step 6 — completion: summarize, archive, calm the office, run the queue. */
export function completeOfficeTask(outcome: "approved" | "rejected") {
  const wf = state.activeWorkflow;
  if (!wf) return;

  clearWorkflowTimers();

  const rejected = outcome === "rejected";
  const stage: WorkflowStage = rejected ? "blocked" : "complete";
  patchWorkflow({
    stage,
    progress: rejected ? wf.progress : 100,
    completedAt: Date.now(),
    currentStep: rejected ? "Workflow rejected at the approval gate" : "Workflow complete and archived",
    nextAction: rejected ? "Re-issue the command with revised instructions" : "None — output archived to the command center",
    etaLabel: rejected ? "Blocked: approval was rejected" : "All assigned agents complete",
  });

  pushChat(
    "earn",
    "Earn",
    rejected
      ? `"${wf.title}" was rejected at the gate. I've stood the team down — outputs are parked and nothing external was released.`
      : `"${wf.title}" is complete. ${wf.assignments.length} output${wf.assignments.length === 1 ? "" : "s"} archived to the command center${wf.riskTier !== "internal" ? " after your approval" : ""}.`
  );
  addAuditEvent({
    actor: "Earn",
    action: rejected ? `Workflow blocked — ${wf.title}` : `Workflow archived — ${wf.title}`,
    room: "Command Center",
    tier: wf.riskTier,
    status: rejected ? "rejected" : "complete",
  });

  // Agents stand down and walk home.
  for (const a of wf.assignments) {
    const home = AGENT_BY_ID[a.agentId].homeRoom;
    updateNPCState(a.agentId, rejected ? "blocked" : "complete", rejected ? "Standing down — gate rejected" : "Output delivered");
    patchAgent(a.agentId, { owns: null, progress: 0, workload: 0 });
    moveNPCToRoom(a.agentId, home);
  }
  updateNPCState("principal", "idle", AGENT_BY_ID.principal.role);
  moveNPCToRoom("principal", AGENT_BY_ID.principal.homeRoom);
  updateNPCState("risk", "idle", AGENT_BY_ID.risk.role);
  moveNPCToRoom("risk", AGENT_BY_ID.risk.homeRoom);

  const archived: ArchivedWorkflow = {
    id: wf.id,
    title: wf.title,
    riskTier: wf.riskTier,
    outcome: rejected ? "rejected" : "complete",
    completedAt: Date.now(),
  };

  after(1600, () => {
    for (const a of wf.assignments) {
      updateNPCState(a.agentId, "idle", AGENT_BY_ID[a.agentId].role);
    }
    deactivateAllRooms();
    setState({
      activeWorkflow: null,
      archive: [archived, ...state.archive].slice(0, 20),
      officeStatus: "calm",
      happeningNow: rejected
        ? `"${wf.title}" was blocked at the approval gate. The audit trail records the rejection.`
        : `"${wf.title}" is archived. The office is calm and the audit trail is up to date.`,
    });
    updateNPCState("earn", "idle", "AI Command Operator");

    // Run the next queued command, if any.
    const [next, ...rest] = state.queuedCommands;
    if (next) {
      setState({ queuedCommands: rest });
      pushChat("earn", "Earn", `Picking up the queued command: "${next}".`);
      classifyAndRoute(next);
    }
  });
}

// ─── Meetings ────────────────────────────────────────────────────────────────

/**
 * Join a structured work session. Participants gather in the meeting room,
 * chat records the event, and mock video presence cards appear.
 * TODO(webrtc): attach real MediaStreams to the presence grid on join.
 */
export function joinMeeting(type: MeetingType) {
  const def = MEETING_TYPES[type];
  const meeting: ActiveMeeting = {
    type,
    label: def.label,
    roomKey: def.roomKey,
    participants: def.participants,
    startedAt: Date.now(),
  };
  setState({ meeting });
  for (const agentId of def.participants) {
    if (state.agents[agentId].state === "idle") {
      updateNPCState(agentId, "collaborating", `In ${def.label}`);
      moveNPCToRoom(agentId, def.roomKey);
    }
  }
  triggerRoomActivity(def.roomKey, true, Math.max(state.rooms[def.roomKey].taskCount, 1), state.activeWorkflow?.riskTier ?? null, def.participants);
  pushChat("meeting", "Office", `You joined ${def.label} in the ${ROOM_BY_KEY[def.roomKey].label}. Participants: ${def.participants.map((p) => AGENT_BY_ID[p].name).join(", ")}.`);
  addAuditEvent({ actor: "You", action: `Meeting joined — ${def.label}`, room: ROOM_BY_KEY[def.roomKey].label, tier: null, status: "info" });
}

export function leaveMeeting() {
  const meeting = state.meeting;
  if (!meeting) return;
  setState({ meeting: null });
  for (const agentId of meeting.participants) {
    if (state.agents[agentId].state === "collaborating") {
      updateNPCState(agentId, "idle", AGENT_BY_ID[agentId].role);
      moveNPCToRoom(agentId, AGENT_BY_ID[agentId].homeRoom);
    }
  }
  if (!state.activeWorkflow) {
    triggerRoomActivity(meeting.roomKey, false, 0, null, []);
  }
  pushChat("meeting", "Office", `You left ${meeting.label}.`);
  addAuditEvent({ actor: "You", action: `Meeting left — ${meeting.label}`, room: ROOM_BY_KEY[meeting.roomKey].label, tier: null, status: "info" });
}

// ─── Direct agent interaction ────────────────────────────────────────────────

/** Clicking an agent on the floor gets a role-specific response in chat. */
export function interactWithAgent(agentId: AgentId) {
  const agent = AGENT_BY_ID[agentId];
  const runtime = state.agents[agentId];
  if (!agent) return;
  const line =
    runtime.state === "working" && runtime.owns
      ? `${runtime.statusLabel} — ${runtime.owns} is at ${runtime.progress}%.`
      : runtime.state === "waiting_for_approval"
        ? "This action requires your approval before I can continue."
        : agent.idleLine;
  pushChat("agent_update", agent.name, line);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Reset transient timers (e.g. on hot reload). State itself is preserved. */
export function shutdownOfficeProgram() {
  clearWorkflowTimers();
}
