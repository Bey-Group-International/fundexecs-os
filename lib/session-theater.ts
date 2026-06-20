import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey, Task, TaskStatus } from "@/lib/supabase/database.types";

export type TheaterStatus = "queued" | "active" | "waiting" | "done" | "blocked";

export interface AgentTheaterNode {
  agent: AgentKey;
  name: string;
  role: string;
  color: string;
  motionStyle: string;
  status: TheaterStatus;
  progress: number;
  activeTitle: string;
  stepCount: number;
  computations: string[];
}

const STATUS_WEIGHT: Record<TheaterStatus, number> = {
  active: 0,
  waiting: 1,
  queued: 2,
  blocked: 3,
  done: 4,
};

function theaterStatus(statuses: TaskStatus[]): TheaterStatus {
  if (statuses.some((s) => s === "failed" || s === "blocked" || s === "cancelled")) return "blocked";
  if (statuses.some((s) => s === "in_progress")) return "active";
  if (statuses.some((s) => s === "awaiting_approval")) return "waiting";
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) return "done";
  return "queued";
}

function computationLines(nodeStatus: TheaterStatus, steps: Task[]): string[] {
  const first = steps[0];
  const title = first?.title ?? "Agent task";
  if (nodeStatus === "active") {
    return [
      `Fetching context for ${title}`,
      "Synthesizing source data, artifacts, and prior outputs",
      "Reasoning through next decision points",
    ];
  }
  if (nodeStatus === "done") {
    return [
      `Completed ${steps.length} task${steps.length === 1 ? "" : "s"}`,
      "Persisted output into the workflow timeline",
      "Ready for review or downstream handoff",
    ];
  }
  if (nodeStatus === "blocked") {
    return ["Requires operator attention", "Holding downstream handoffs", "Review the step state in the transcript"];
  }
  if (nodeStatus === "waiting") {
    return ["Plan drafted", "Waiting for approval before execution", "No external action has run yet"];
  }
  return ["Queued for execution", "Standing by for Earn orchestration", "Context will stream here when active"];
}

export function buildAgentTheater(steps: Task[]): AgentTheaterNode[] {
  const byAgent = new Map<AgentKey, Task[]>();
  for (const step of steps) {
    const list = byAgent.get(step.assigned_agent) ?? [];
    list.push(step);
    byAgent.set(step.assigned_agent, list);
  }

  return [...byAgent.entries()]
    .map(([agentKey, agentSteps]) => {
      const agent = AGENT_BY_KEY[agentKey];
      const status = theaterStatus(agentSteps.map((s) => s.status));
      const active = agentSteps.find((s) => s.status === "in_progress") ?? agentSteps.find((s) => s.status !== "completed") ?? agentSteps[0];
      const progress = agentSteps.reduce((sum, step) => sum + step.progress, 0) / Math.max(agentSteps.length, 1);
      return {
        agent: agentKey,
        name: agent?.name ?? agentKey,
        role: agent?.role ?? "Agent",
        color: agent?.color ?? "#94a3b8",
        motionStyle: agent?.motionStyle ?? "focused",
        status,
        progress,
        activeTitle: active?.title ?? "Agent task",
        stepCount: agentSteps.length,
        computations: computationLines(status, agentSteps),
      };
    })
    .sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] || a.name.localeCompare(b.name));
}

export function activeAgent(nodes: AgentTheaterNode[]): AgentKey | null {
  return nodes.find((node) => node.status === "active")?.agent ?? nodes[0]?.agent ?? null;
}

export const __test = {
  theaterStatus,
};
