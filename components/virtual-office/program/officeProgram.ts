/**
 * FundExecs OS — Office Program model.
 *
 * Framework-free types and static configuration for the institutional
 * execution floor: AI executive agents, room purposes, workflow intents,
 * approval tiers, and meeting types.
 *
 * This module is the contract the frontend will later share with:
 *  - the FundExecs workflow engine (task routing / stage transitions)
 *  - the Earn command backend (intent classification)
 *  - the agent task engine (per-agent execution state)
 *  - the audit database (append-only event log)
 *  - the role-based permission system (approval tiers)
 */

// ─── Modes, tiers, stages ────────────────────────────────────────────────────

/** Operating mode for Earn. Displayed in the HUD at all times. */
export type WorkflowMode = "conversation" | "copilot" | "workflow";

export const WORKFLOW_MODES: Array<{ id: WorkflowMode; label: string; blurb: string }> = [
  { id: "conversation", label: "Conversation", blurb: "Chat with Earn. No autonomous work begins." },
  { id: "copilot",      label: "Copilot",      blurb: "Earn proposes a plan and waits for your approval before executing." },
  { id: "workflow",     label: "Workflow",     blurb: "Earn executes approved workflows across rooms and agents within defined limits." },
];

/** Risk tier for a task. Tier 2/3 always create an approval gate. */
export type RiskTier = "internal" | "external_facing" | "capital_binding";

export const RISK_TIERS: Record<RiskTier, { label: string; short: string; color: string }> = {
  internal:        { label: "Tier 1 — Internal",        short: "T1", color: "#38bdf8" },
  external_facing: { label: "Tier 2 — External-Facing", short: "T2", color: "#f59e0b" },
  capital_binding: { label: "Tier 3 — Capital-Binding", short: "T3", color: "#ef4444" },
};

export type WorkflowStage =
  | "received"
  | "classified"
  | "planned"
  | "assigned"
  | "in_progress"
  | "review"
  | "approval"
  | "complete"
  | "blocked";

export const STAGE_ORDER: WorkflowStage[] = [
  "received", "classified", "planned", "assigned", "in_progress", "review", "approval", "complete",
];

export const STAGE_LABELS: Record<WorkflowStage, string> = {
  received:    "Received",
  classified:  "Classified",
  planned:     "Planned",
  assigned:    "Assigned",
  in_progress: "In Progress",
  review:      "Review",
  approval:    "Approval",
  complete:    "Complete",
  blocked:     "Blocked",
};

// ─── Agents ──────────────────────────────────────────────────────────────────

export type AgentId =
  | "earn"
  | "associate"
  | "principal"
  | "analyst"
  | "risk"
  | "legal"
  | "investor_relations"
  | "treasury"
  | "portfolio_ops"
  | "ops_admin"
  | "business_dev";

export type AgentState =
  | "idle"
  | "listening"
  | "classifying"
  | "assigned"
  | "moving"
  | "working"
  | "collaborating"
  | "waiting_for_approval"
  | "reviewing"
  | "complete"
  | "blocked";

/** Physical room keys — match ROOMS in ../types.ts and the Tiled map. */
export type RoomKey =
  | "ceo"
  | "boardroom"
  | "trading"
  | "research"
  | "office"
  | "ops"
  | "legal"
  | "marketing"
  | "reception";

export type ProgramAgent = {
  id: AgentId;
  /** Executive display name shown above the avatar. */
  name: string;
  /** Institutional role line. */
  role: string;
  /** Sprite sheet id from characterConfig — all are humanized executive figures. */
  spriteKey: string;
  /** Room the agent works from when idle. */
  homeRoom: RoomKey;
  /** Role accent used for auras / badges. */
  accent: string;
  /** What the agent says when the user approaches / clicks them while idle. */
  idleLine: string;
};

export const PROGRAM_AGENTS: ProgramAgent[] = [
  { id: "earn",               name: "Earn",               role: "AI Command Operator",           spriteKey: "earnest-fundmaker",   homeRoom: "ceo",       accent: "#fbbf24", idleLine: "Give me a task and I will route it into a plan." },
  { id: "associate",          name: "Associate",          role: "Deal Execution",                spriteKey: "deal-sourcer",        homeRoom: "trading",   accent: "#f97316", idleLine: "Standing by for deal screening and data-room work." },
  { id: "principal",          name: "Principal",          role: "Deal Supervision",              spriteKey: "executive-advisor",   homeRoom: "boardroom", accent: "#a855f7", idleLine: "I supervise deal review and boardroom decisions." },
  { id: "analyst",            name: "Analyst",            role: "Underwriting & Research",       spriteKey: "capital-raiser",      homeRoom: "office",    accent: "#ec4899", idleLine: "I'm ready to run models and review assumptions." },
  { id: "risk",               name: "Risk & Compliance",  role: "Controls & Approvals",          spriteKey: "workflow-instructor", homeRoom: "legal",     accent: "#ef4444", idleLine: "External-facing and capital-binding actions require approval." },
  { id: "legal",              name: "Legal",              role: "Documents & Transactions",      spriteKey: "legal-admin",         homeRoom: "legal",     accent: "#64748b", idleLine: "I review NDAs, subscription docs, and closing papers." },
  { id: "investor_relations", name: "Investor Relations", role: "LP Communications",             spriteKey: "investor-relations",  homeRoom: "reception", accent: "#f59e0b", idleLine: "LP update workflow is ready whenever you are." },
  { id: "treasury",           name: "Treasury",           role: "Capital Movement & Settlement", spriteKey: "capital-connector",   homeRoom: "marketing", accent: "#14b8a6", idleLine: "Capital calls and settlement stay locked until you approve." },
  { id: "portfolio_ops",      name: "Portfolio Ops",      role: "Post-Close Execution",          spriteKey: "automater",           homeRoom: "ops",       accent: "#22c55e", idleLine: "Tracking KPIs and operating plans across the portfolio." },
  { id: "ops_admin",          name: "Ops / Admin",        role: "Fund Administration",           spriteKey: "curator",             homeRoom: "ops",       accent: "#d946ef", idleLine: "Fund admin, reporting, and the compliance calendar are current." },
  { id: "business_dev",       name: "Business Dev",       role: "Sourcing & Partnerships",       spriteKey: "rainmaker",           homeRoom: "trading",   accent: "#84cc16", idleLine: "Sourcing pipeline and partner map are up to date." },
];

export const AGENT_BY_ID: Record<AgentId, ProgramAgent> = Object.fromEntries(
  PROGRAM_AGENTS.map((a) => [a.id, a])
) as Record<AgentId, ProgramAgent>;

// ─── Rooms ───────────────────────────────────────────────────────────────────

export type ProgramRoom = {
  key: RoomKey;
  /** Institutional label rendered on the floor and in navigation. */
  label: string;
  /** One-line programmatic purpose. */
  purpose: string;
};

export const PROGRAM_ROOMS: ProgramRoom[] = [
  { key: "ceo",       label: "Command Center",    purpose: "Central planning, delegation, workflow control" },
  { key: "boardroom", label: "Boardroom",         purpose: "Final review, IC memos, executive approvals" },
  { key: "trading",   label: "Deal Room",         purpose: "Sourcing, target screening, acquisition pipeline" },
  { key: "research",  label: "Diligence Room",    purpose: "Data-room review, red flags, market validation" },
  { key: "office",    label: "Underwriting Desk", purpose: "Valuation, LBO logic, scenarios, IC assumptions" },
  { key: "ops",       label: "Portfolio Ops",     purpose: "KPI tracking, post-close execution, vendor work" },
  { key: "legal",     label: "Compliance & Legal", purpose: "NDAs, subscription docs, risk gates, approvals" },
  { key: "marketing", label: "Treasury Desk",     purpose: "Capital calls, closing mechanics, settlement" },
  { key: "reception", label: "IR Lounge",         purpose: "LP updates, capital raise pipeline, investor comms" },
];

export const ROOM_BY_KEY: Record<RoomKey, ProgramRoom> = Object.fromEntries(
  PROGRAM_ROOMS.map((r) => [r.key, r])
) as Record<RoomKey, ProgramRoom>;

// ─── Tasks & workflows ───────────────────────────────────────────────────────

export type WorkflowIntent =
  | "data_room_build"
  | "underwriting"
  | "investor_relations"
  | "capital_movement"
  | "compliance_review"
  | "deal_screening"
  | "portfolio_ops"
  | "ic_review"
  | "general_execution";

/** A single agent's slice of an active workflow. */
export type AgentAssignment = {
  agentId: AgentId;
  /** Room the agent executes from for this workflow. */
  roomKey: RoomKey;
  /** Deliverable the agent owns — shown on the ownership badge. */
  owns: string;
  /** Role-specific executive status text — never "Working…". */
  status: string;
  progress: number; // 0–100
  done: boolean;
};

export type ApprovalGate = {
  id: string;
  workflowId: string;
  title: string;
  tier: Exclude<RiskTier, "internal">;
  status: "pending" | "approved" | "rejected";
  /** Who flagged the gate. */
  requiredBy: AgentId;
  roomKey: RoomKey;
  reason: string;
};

export type OfficeWorkflow = {
  id: string;
  title: string;
  commandText: string;
  intent: WorkflowIntent;
  mode: WorkflowMode;
  stage: WorkflowStage;
  riskTier: RiskTier;
  assignments: AgentAssignment[];
  activeRooms: RoomKey[];
  /** 0–100 across all assignments. */
  progress: number;
  /** Stage-based readiness language — never a fake clock time. */
  etaLabel: string;
  currentStep: string;
  nextAction: string;
  approvalGate: ApprovalGate | null;
  createdAt: number;
  completedAt: number | null;
};

export type AuditEvent = {
  id: string;
  ts: number;
  actor: string;
  action: string;
  room: string;
  tier: RiskTier | null;
  status: "info" | "pending" | "approved" | "rejected" | "complete";
};

export type ChatKind =
  | "user_command"
  | "earn"
  | "agent_update"
  | "system"
  | "approval"
  | "meeting";

export type ChatMessage = {
  id: string;
  ts: number;
  kind: ChatKind;
  author: string;
  text: string;
};

// ─── Meetings ────────────────────────────────────────────────────────────────

export type MeetingType =
  | "deal_review"
  | "ic_review"
  | "lp_update"
  | "compliance_review"
  | "boardroom_approval"
  | "portfolio_standup"
  | "capital_closing";

export const MEETING_TYPES: Record<
  MeetingType,
  { label: string; roomKey: RoomKey; participants: AgentId[] }
> = {
  deal_review:        { label: "Deal Review",            roomKey: "trading",   participants: ["earn", "associate", "principal"] },
  ic_review:          { label: "IC Review",              roomKey: "boardroom", participants: ["earn", "principal", "analyst", "risk"] },
  lp_update:          { label: "LP Update",              roomKey: "reception", participants: ["earn", "investor_relations", "legal"] },
  compliance_review:  { label: "Compliance Review",      roomKey: "legal",     participants: ["earn", "risk", "legal"] },
  boardroom_approval: { label: "Boardroom Approval",     roomKey: "boardroom", participants: ["earn", "principal", "risk", "legal"] },
  portfolio_standup:  { label: "Portfolio Ops Standup",  roomKey: "ops",       participants: ["earn", "portfolio_ops", "ops_admin"] },
  capital_closing:    { label: "Capital Closing Review", roomKey: "boardroom", participants: ["earn", "treasury", "legal", "risk"] },
};

export type ActiveMeeting = {
  type: MeetingType;
  label: string;
  roomKey: RoomKey;
  /** Agent participants plus the local user. */
  participants: AgentId[];
  startedAt: number;
};

// ─── Suggested commands ──────────────────────────────────────────────────────

export const SUGGESTED_COMMANDS: string[] = [
  "Build investor-ready data room",
  "Screen acquisition target",
  "Prepare IC memo",
  "Draft LP update",
  "Review compliance queue",
  "Run underwriting model",
  "Prepare closing wires",
];

// ─── Task router ─────────────────────────────────────────────────────────────

export type RoutingResult = {
  intent: WorkflowIntent;
  title: string;
  riskTier: RiskTier;
  /** Every assignment includes the room the agent will execute from. */
  assignments: Array<Omit<AgentAssignment, "progress" | "done">>;
  activeRooms: RoomKey[];
  /** Earn's plan announcement, posted to chat when the task is classified. */
  earnPlan: string;
};

/**
 * Map raw user intent to agents, rooms, and risk tier.
 *
 * TODO(backend): replace keyword matching with the Earn command backend's
 * intent classifier. The RoutingResult contract stays the same.
 */
export function routeTaskToAgents(taskText: string): RoutingResult {
  const t = taskText.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has("data room", "dataroom")) {
    return {
      intent: "data_room_build",
      title: "Investor-Ready Data Room Build",
      riskTier: "external_facing",
      assignments: [
        { agentId: "associate",          roomKey: "trading",   owns: "Data Room Index",    status: "Structuring the data room index" },
        { agentId: "analyst",            roomKey: "office",    owns: "Financial Summary",  status: "Reviewing underwriting assumptions" },
        { agentId: "risk",               roomKey: "legal",     owns: "Approval Review",    status: "Checking external-facing risk" },
        { agentId: "legal",              roomKey: "legal",     owns: "Document Review",    status: "Confirming disclosures and NDAs" },
        { agentId: "investor_relations", roomKey: "reception", owns: "LP Positioning",     status: "Preparing investor-ready framing" },
      ],
      activeRooms: ["ceo", "trading", "research", "office", "legal", "reception", "boardroom"],
      earnPlan:
        "I will route this through the Deal Room, Diligence, Underwriting, Compliance, and the IR Lounge, with Boardroom review at the end. Tier 2 approval is required before investor-facing materials are finalized.",
    };
  }

  if (has("model", "underwrit", "valuation", "lbo", "ic memo", "scenario")) {
    return {
      intent: t.includes("ic memo") ? "ic_review" : "underwriting",
      title: t.includes("ic memo") ? "IC Memo Preparation" : "Underwriting Model Run",
      riskTier: "internal",
      assignments: [
        { agentId: "analyst",   roomKey: "office",    owns: "Model & Scenarios",  status: "Running assumptions and sensitivities" },
        { agentId: "principal", roomKey: "boardroom", owns: "IC Assumptions",     status: "Reviewing deal logic for IC" },
        { agentId: "risk",      roomKey: "legal",     owns: "Assumption Controls", status: "Monitoring model assumptions" },
      ],
      activeRooms: ["ceo", "office", "boardroom", "legal"],
      earnPlan:
        "Routing to the Underwriting Desk with Principal oversight in the Boardroom. This is Tier 1 internal analysis — no approval gate required.",
    };
  }

  if (has("investor", "lp ", "lp update", "fundrais", "update")) {
    return {
      intent: "investor_relations",
      title: "LP Update & Investor Communications",
      riskTier: "external_facing",
      assignments: [
        { agentId: "investor_relations", roomKey: "reception", owns: "LP Update Draft",       status: "Drafting the LP update" },
        { agentId: "legal",              roomKey: "legal",     owns: "Language Review",       status: "Reviewing external-facing language" },
        { agentId: "risk",               roomKey: "legal",     owns: "Distribution Controls", status: "Verifying communication controls" },
      ],
      activeRooms: ["ceo", "reception", "legal", "boardroom"],
      earnPlan:
        "Routing through the IR Lounge and Compliance & Legal, then the Boardroom approval queue. Tier 2 approval is required before anything reaches investors.",
    };
  }

  if (has("wire", "capital call", "settlement", "closing", "subscription")) {
    return {
      intent: "capital_movement",
      title: "Capital Movement & Closing Mechanics",
      riskTier: "capital_binding",
      assignments: [
        { agentId: "treasury",  roomKey: "marketing", owns: "Settlement Checklist", status: "Preparing settlement mechanics" },
        { agentId: "legal",     roomKey: "legal",     owns: "Closing Documents",    status: "Reviewing closing documents" },
        { agentId: "risk",      roomKey: "legal",     owns: "Capital Controls",     status: "Enforcing capital-binding controls" },
        { agentId: "ops_admin", roomKey: "ops",       owns: "Fund Records",         status: "Reconciling fund records" },
      ],
      activeRooms: ["ceo", "marketing", "legal", "ops", "boardroom"],
      earnPlan:
        "This is Tier 3 capital-binding work. Treasury, Legal, and Risk will prepare everything, but nothing moves without your explicit approval at the Boardroom gate.",
    };
  }

  if (has("compliance", "nda", "regulatory", "legal review")) {
    return {
      intent: "compliance_review",
      title: "Compliance Queue Review",
      riskTier: "internal",
      assignments: [
        { agentId: "risk",      roomKey: "legal", owns: "Compliance Queue", status: "Reviewing open compliance items" },
        { agentId: "legal",     roomKey: "legal", owns: "Document Queue",   status: "Clearing pending document reviews" },
        { agentId: "ops_admin", roomKey: "ops",   owns: "Compliance Calendar", status: "Updating the compliance calendar" },
      ],
      activeRooms: ["ceo", "legal", "ops"],
      earnPlan:
        "Risk & Compliance and Legal will clear the queue in the Compliance & Legal office. Tier 1 internal review.",
    };
  }

  if (has("screen", "target", "acquisition", "pipeline", "source", "deal")) {
    return {
      intent: "deal_screening",
      title: "Acquisition Target Screening",
      riskTier: "internal",
      assignments: [
        { agentId: "associate",    roomKey: "trading",  owns: "Screening Checklist", status: "Screening the target profile" },
        { agentId: "business_dev", roomKey: "trading",  owns: "Sourcing Context",    status: "Mapping sourcing relationships" },
        { agentId: "analyst",      roomKey: "research", owns: "Market Validation",   status: "Validating market assumptions" },
      ],
      activeRooms: ["ceo", "trading", "research"],
      earnPlan:
        "The Associate and Business Development will screen the target in the Deal Room while the Analyst validates the market in Diligence. Tier 1 internal analysis.",
    };
  }

  if (has("kpi", "portfolio", "post-close", "vendor", "operating plan")) {
    return {
      intent: "portfolio_ops",
      title: "Portfolio Operations Review",
      riskTier: "internal",
      assignments: [
        { agentId: "portfolio_ops", roomKey: "ops", owns: "KPI Board",       status: "Refreshing KPI dashboards" },
        { agentId: "ops_admin",     roomKey: "ops", owns: "Reporting Pack",  status: "Assembling the reporting pack" },
      ],
      activeRooms: ["ceo", "ops"],
      earnPlan:
        "Portfolio Ops will refresh KPIs and the reporting pack on the Ops floor. Tier 1 internal work.",
    };
  }

  // No silent tasks: unclassified input still routes visibly.
  return {
    intent: "general_execution",
    title: "General Execution Task",
    riskTier: "internal",
    assignments: [
      { agentId: "associate", roomKey: "trading", owns: "First-Pass Handling", status: "Working the task first-pass" },
    ],
    activeRooms: ["ceo", "trading"],
    earnPlan:
      "Received. I'll treat this as a general execution task and route it to the Associate for first-pass handling.",
  };
}
