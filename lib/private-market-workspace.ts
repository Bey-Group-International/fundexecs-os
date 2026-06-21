export type HQState = "idle" | "activated" | "semiActive" | "fullyActive";

export interface HQAgent {
  name: string;
  title: string;
  suite: string;
  x: number;
  y: number;
}

export const HQ_STATES: Record<
  HQState,
  {
    label: string;
    description: string;
    motion: "standby" | "waking" | "earn-led" | "team-takeover";
  }
> = {
  idle: {
    label: "Idle HQ",
    description: "Executive suites are in standby until a session begins.",
    motion: "standby",
  },
  activated: {
    label: "HQ Activation",
    description: "Earn reviews the prompt and drafts a structured plan.",
    motion: "waking",
  },
  semiActive: {
    label: "Earn Lead",
    description: "Earn owns the strategy while querying offices for assists.",
    motion: "earn-led",
  },
  fullyActive: {
    label: "Team Takeover",
    description: "Approve & Automate delegates work across the full executive team.",
    motion: "team-takeover",
  },
};

export const HQ_AGENTS: HQAgent[] = [
  { name: "Earn", title: "Managing Partner, AI Orchestration", suite: "Headquarters", x: 50, y: 50 },
  { name: "Mara Chen", title: "Head of Investor Relations", suite: "Capital Formation", x: 20, y: 24 },
  { name: "Darius Vale", title: "Lead Underwriter", suite: "Underwriting", x: 78, y: 23 },
  { name: "Nadia Cross", title: "Chief Compliance Officer", suite: "Legal & Compliance", x: 78, y: 72 },
  { name: "Julian Brooks", title: "Operating Partner", suite: "Portfolio Operations", x: 22, y: 73 },
  { name: "Sofia Grant", title: "Chief of Staff", suite: "Executive Council", x: 50, y: 18 },
];

export const HQ_LOGS: Record<HQState, string[]> = {
  idle: [
    "hq.sleep_mode=true",
    "agents.standby_at_desks()",
    "waiting_for_session_input",
  ],
  activated: [
    "earn.read_initial_prompt()",
    "plan.structure_workflow(Build, Source, Run, Execute)",
    "approval_gate.prepare_strategy()",
  ],
  semiActive: [
    "earn.compute_primary_strategy()",
    "ir.fetch_capital_context()",
    "underwriter.return_assumption_range()",
  ],
  fullyActive: [
    "workclaw.browser.open_data_room()",
    "api.execute('/v1/deals/screen')",
    "rpa.extract_termsheet_fields()",
    "agents.sync_artifacts_to_session()",
  ],
};

export function nextHQStateOnPrompt(current: HQState, prompt: string): HQState {
  if (!prompt.trim()) return current;
  return current === "idle" ? "activated" : current;
}

export function activeAgentCount(state: HQState): number {
  if (state === "idle") return 0;
  if (state === "activated") return 1;
  if (state === "semiActive") return 3;
  return HQ_AGENTS.length;
}

export function isAgentMoving(state: HQState, agentName: string): boolean {
  if (state === "fullyActive") return true;
  if (state === "semiActive") return ["Earn", "Mara Chen", "Darius Vale"].includes(agentName);
  if (state === "activated") return agentName === "Earn";
  return false;
}
