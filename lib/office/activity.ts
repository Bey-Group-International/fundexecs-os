// Live agent activity for the Virtual Office. Pure, DOM-free.
//
// The AI agents seated at desks should reflect what they are ACTUALLY doing,
// derived from real task data (`tasks` / `task_events`) for the org. When an
// agent has no in-flight work we fall back to a deterministic, role-based
// resting state so the office never looks dead.
//
// Mapping (read from lib/supabase/database.types.ts, not assumed):
//   - `tasks.assigned_agent` (AgentKey, non-null) links a task to its agent.
//   - `tasks.status` (TaskStatus) tells us whether it is still in-flight.
//   - `task_events.agent` (AgentKey | null) links an event to its agent.
//   - `task_events.event_type` (string) + `task_events.payload` carry the live
//     phrase the engine emits ("<step title>…").
//   - both tables expose `created_at` for recency.
import type { Task, TaskEvent, TaskStatus, AgentKey } from "@/lib/supabase/database.types";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import type { PresenceStatus } from "./presence";

// Re-export the exact row shapes this module consumes, so callers (and the
// server fetcher) share one source of truth.
export type TaskRow = Task;
export type TaskEventRow = TaskEvent;

export interface AgentActivity {
  status: PresenceStatus;
  /** Short human phrase, e.g. "Running a valuation" or "Idle at desk". */
  label: string;
  busy: boolean;
}

// A task in one of these statuses is finished — its agent is no longer working
// on it. Everything else (pending / in_progress / awaiting_approval / blocked)
// counts as in-flight, so the desk shows the agent as busy.
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

// Event types the engine emits while an agent is actively working a step.
const ACTIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "task.created",
  "task.progress",
  "task.handoff",
]);

// Event types that mark a task's work as done — they supersede any earlier
// active event for the same task.
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set(["task.completed"]);

/** Turn a snake_case capability/role token into readable words. */
function humanize(token: string): string {
  return token.replace(/_/g, " ").trim();
}

/** Uppercase the first letter without touching the rest. */
function capitalize(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * A short, deterministic idle phrase for an agent with no active work — derived
 * from its role/capabilities so each desk rests in character rather than all
 * reading "Idle". Reusable so the server fallback and the pure derivation agree.
 */
export function restingActivity(agentKey: string): AgentActivity {
  const def = AGENT_BY_KEY[agentKey as AgentKey];
  let label = "Idle at desk";
  if (def) {
    const capability = def.capabilities[0];
    label = capability
      ? `Ready for ${humanize(capability)}`
      : `Standing by — ${capitalize(humanize(def.role.split(/[.,;]/)[0] ?? "")).slice(0, 48) || "idle at desk"}`;
  }
  return { status: "available", label, busy: false };
}

/** Clean a task/step title into a short "doing" phrase. */
function labelFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = title.replace(/[.…\s]+$/u, "").trim();
  if (!cleaned) return null;
  return capitalize(cleaned).slice(0, 80);
}

/** Safely read a string `message` off an event payload (Json is untyped). */
function messageFromPayload(payload: unknown): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string") return labelFromTitle(message);
  }
  return null;
}

// A busy signal for one agent, carrying its recency so the freshest one wins.
interface BusySignal {
  label: string;
  at: number;
}

/** Parse an ISO timestamp to millis; unparseable/absent sorts oldest. */
function toMillis(ts: string | null | undefined): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Derive each agent's live activity from recent tasks + task_events.
 *
 * - An in-flight task (non-terminal status) marks its `assigned_agent` busy,
 *   labelled from the task title.
 * - A recent active event (task.created / task.progress / task.handoff) whose
 *   task has not since produced a terminal event also marks its `agent` busy,
 *   labelled from the event's payload message.
 * - Per agent the freshest signal wins the label.
 * - Every known agent gets an entry; agents with no active work rest via
 *   `restingActivity`. Unknown agent keys in the data are ignored.
 *
 * Pure and deterministic: identical inputs always yield identical output.
 */
export function deriveAgentActivity(params: {
  tasks: TaskRow[];
  events: TaskEventRow[];
}): Record<string, AgentActivity> {
  const { tasks, events } = params;
  const known = new Set<string>(AGENTS.map((a) => a.key));
  const busy = new Map<string, BusySignal>();

  const record = (agentKey: string | null, label: string | null, at: number) => {
    if (!agentKey || !known.has(agentKey) || !label) return;
    const existing = busy.get(agentKey);
    if (!existing || at >= existing.at) {
      busy.set(agentKey, { label, at });
    }
  };

  // Tasks: any non-terminal task means its agent is actively on the work.
  for (const task of tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue;
    record(task.assigned_agent, labelFromTitle(task.title), toMillis(task.created_at));
  }

  // Events: fold to the latest event per task so a completion supersedes an
  // earlier progress event and the task no longer reads as active.
  const latestByTask = new Map<string, TaskEventRow>();
  const orphanEvents: TaskEventRow[] = [];
  for (const event of events) {
    if (!event.task_id) {
      orphanEvents.push(event);
      continue;
    }
    const prev = latestByTask.get(event.task_id);
    if (!prev || toMillis(event.created_at) >= toMillis(prev.created_at)) {
      latestByTask.set(event.task_id, event);
    }
  }

  const consider = (event: TaskEventRow) => {
    if (TERMINAL_EVENT_TYPES.has(event.event_type)) return;
    if (!ACTIVE_EVENT_TYPES.has(event.event_type)) return;
    record(event.agent, messageFromPayload(event.payload), toMillis(event.created_at));
  };
  for (const event of latestByTask.values()) consider(event);
  // Events with no task_id can't be superseded; treat each on its own merit.
  for (const event of orphanEvents) consider(event);

  // Build the full map: busy agents first, everyone else resting.
  const out: Record<string, AgentActivity> = {};
  for (const agent of AGENTS) {
    const signal = busy.get(agent.key);
    out[agent.key] = signal
      ? { status: "focusing", label: signal.label, busy: true }
      : restingActivity(agent.key);
  }
  return out;
}
