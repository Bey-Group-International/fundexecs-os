export type TwinPhase = "idle" | "prompt" | "planning" | "authorized" | "executing" | "complete";

export type SignalColor = "gold" | "blue" | "green" | "navy";

export interface TwinAgent {
  name: string;
  title: string;
  district: string;
  responsibilities: string[];
  x: number;
  y: number;
  signal: SignalColor;
}

export interface TwinDistrict {
  name: string;
  summary: string;
  x: number;
  y: number;
  w: number;
  h: number;
  signal: SignalColor;
}

export interface TaskNode {
  title: string;
  agent: string;
  signal: SignalColor;
}

export const TWIN_PHASES: Record<
  TwinPhase,
  {
    label: string;
    status: string;
    description: string;
    capacity: number;
    throughput: number;
    motion: "standby" | "analyzing" | "planning" | "authorization" | "executing" | "complete";
  }
> = {
  idle: {
    label: "Idle",
    status: "Awaiting Instructions",
    description: "Earn is seated in the Executive Operations Center while the campus holds baseline monitoring.",
    capacity: 10,
    throughput: 12,
    motion: "standby",
  },
  prompt: {
    label: "User Prompt",
    status: "Analyzing Request",
    description: "Earn receives the command, classifies the workflow, and wakes the intelligence layer.",
    capacity: 20,
    throughput: 28,
    motion: "analyzing",
  },
  planning: {
    label: "Planning",
    status: "Plan Ready",
    description: "Earn composes objectives, workstreams, assigned agents, and approval gates.",
    capacity: 30,
    throughput: 42,
    motion: "planning",
  },
  authorized: {
    label: "Approval Hero Moment",
    status: "Execution Authorized",
    description: "Earn stands up, the neural network expands, and the task graph fully materializes.",
    capacity: 72,
    throughput: 76,
    motion: "authorization",
  },
  executing: {
    label: "Autonomous Execution",
    status: "Executing",
    description: "Earn delegates work across capital, deal, diligence, legal, operations, marketing, and relationship agents.",
    capacity: 100,
    throughput: 96,
    motion: "executing",
  },
  complete: {
    label: "Completion",
    status: "Execution Complete",
    description: "Task graph collapses into outcomes and Earn returns to the Executive Operations Center.",
    capacity: 18,
    throughput: 34,
    motion: "complete",
  },
};

export const TWIN_DISTRICTS: TwinDistrict[] = [
  { name: "Executive Operations Center", summary: "Earn orchestration and decision routing", x: 39, y: 38, w: 22, h: 20, signal: "gold" },
  { name: "Intelligence Center", summary: "AI brain, confidence, utilization, velocity", x: 37, y: 8, w: 26, h: 17, signal: "green" },
  { name: "Capital Markets Hub", summary: "LPs, family offices, lenders, funds", x: 6, y: 12, w: 25, h: 21, signal: "gold" },
  { name: "Deal Flow Center", summary: "Target sourcing and opportunity qualification", x: 7, y: 62, w: 25, h: 22, signal: "navy" },
  { name: "Diligence Lab", summary: "Risk, underwriting, financial review", x: 68, y: 11, w: 25, h: 22, signal: "green" },
  { name: "Legal & Compliance Wing", summary: "Documentation and transaction review", x: 70, y: 63, w: 23, h: 22, signal: "blue" },
  { name: "Relationship Network Center", summary: "Introductions, CRM, follow-ups", x: 7, y: 38, w: 23, h: 18, signal: "blue" },
  { name: "Portfolio Operations Hub", summary: "Portfolio support and workflow execution", x: 38, y: 69, w: 23, h: 18, signal: "navy" },
  { name: "Marketing Studio", summary: "Outreach and campaign execution", x: 70, y: 38, w: 23, h: 18, signal: "gold" },
];

export const TWIN_AGENTS: TwinAgent[] = [
  {
    name: "Earn",
    title: "Chief Executive Agent",
    district: "Executive Operations Center",
    responsibilities: ["Planning", "Orchestration", "Delegation", "Monitoring", "Decision routing"],
    x: 50,
    y: 48,
    signal: "gold",
  },
  {
    name: "Capital Agent",
    title: "Capital Formation Executive",
    district: "Capital Markets Hub",
    responsibilities: ["Capital raising", "LP matching", "Investor sourcing"],
    x: 19,
    y: 24,
    signal: "gold",
  },
  {
    name: "Deal Agent",
    title: "Deal Flow Executive",
    district: "Deal Flow Center",
    responsibilities: ["Deal sourcing", "Pipeline creation", "Opportunity qualification"],
    x: 20,
    y: 73,
    signal: "navy",
  },
  {
    name: "Diligence Agent",
    title: "Underwriting Executive",
    district: "Diligence Lab",
    responsibilities: ["Risk analysis", "Underwriting", "Financial review"],
    x: 81,
    y: 24,
    signal: "green",
  },
  {
    name: "Legal Agent",
    title: "Legal & Compliance Executive",
    district: "Legal & Compliance Wing",
    responsibilities: ["Documentation", "Compliance", "Transaction review"],
    x: 82,
    y: 74,
    signal: "blue",
  },
  {
    name: "Operations Agent",
    title: "Portfolio Operations Executive",
    district: "Portfolio Operations Hub",
    responsibilities: ["Portfolio support", "Workflow execution"],
    x: 50,
    y: 79,
    signal: "navy",
  },
  {
    name: "Marketing Agent",
    title: "Market Outreach Executive",
    district: "Marketing Studio",
    responsibilities: ["Outreach", "Campaign execution"],
    x: 82,
    y: 48,
    signal: "gold",
  },
  {
    name: "Relationship Agent",
    title: "Relationship Capital Executive",
    district: "Relationship Network Center",
    responsibilities: ["CRM", "Introductions", "Follow-ups"],
    x: 19,
    y: 48,
    signal: "blue",
  },
];

export const TASK_GRAPH: TaskNode[] = [
  { title: "Source Targets", agent: "Deal Agent", signal: "navy" },
  { title: "Build Outreach List", agent: "Marketing Agent", signal: "gold" },
  { title: "Qualify Opportunities", agent: "Deal Agent", signal: "navy" },
  { title: "Analyze Financials", agent: "Diligence Agent", signal: "green" },
  { title: "Build CIM Review", agent: "Legal Agent", signal: "blue" },
  { title: "Prepare Financing Package", agent: "Capital Agent", signal: "gold" },
  { title: "Generate Investor Updates", agent: "Relationship Agent", signal: "blue" },
];

export const EXECUTION_LOGS: Record<TwinPhase, string[]> = {
  idle: [
    "earn.monitor_capacity(10%)",
    "neural_paths.baseline_pulse()",
    "awaiting_private_market_command",
  ],
  prompt: [
    "command.received('find acquisition targets')",
    "earn.classify_workflow(Source + Capital + Diligence)",
    "intelligence_core.wake()",
  ],
  planning: [
    "earn.compose_objectives()",
    "task_graph.materialize(7 nodes)",
    "approval_gate.prepare()",
  ],
  authorized: [
    "approval.received()",
    "earn.expand_neural_network()",
    "campus.execution_lock=true",
  ],
  executing: [
    "deal_agent.qualify_targets()",
    "capital_agent.match_lenders()",
    "diligence_agent.score_risk()",
    "relationship_agent.schedule_introductions()",
  ],
  complete: [
    "results.commit_to_dashboard()",
    "task_graph.collapse_to_outcomes()",
    "earn.return_to_operations_center()",
  ],
};

export function nextTwinPhaseOnPrompt(current: TwinPhase, prompt: string): TwinPhase {
  if (!prompt.trim()) return current;
  return current === "idle" ? "prompt" : current;
}

export function activeAgentCount(phase: TwinPhase): number {
  if (phase === "idle") return 1;
  if (phase === "prompt") return 2;
  if (phase === "planning") return 4;
  if (phase === "authorized") return TWIN_AGENTS.length;
  if (phase === "executing") return TWIN_AGENTS.length;
  return 1;
}

export function isAgentExecuting(phase: TwinPhase, agentName: string): boolean {
  if (agentName === "Earn") return phase !== "idle";
  if (phase === "authorized" || phase === "executing") return true;
  if (phase === "planning") return ["Capital Agent", "Deal Agent", "Diligence Agent"].includes(agentName);
  if (phase === "prompt") return agentName === "Relationship Agent";
  return false;
}

export function taskNodeStatus(phase: TwinPhase, index: number): "pending" | "active" | "complete" {
  if (phase === "complete") return "complete";
  if (phase === "executing") return index < 4 ? "complete" : index === 4 ? "active" : "pending";
  if (phase === "authorized") return index === 0 ? "active" : "pending";
  if (phase === "planning") return "pending";
  return "pending";
}
