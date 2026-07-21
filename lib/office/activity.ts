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

/**
 * Coarse work-state for an agent, independent of its presence `status`:
 *  - "active"  — actively working a step (drives the busy pulse).
 *  - "idle"    — resting, or just wrapped a task (no in-flight work).
 *  - "blocked" — stalled on an error / needs human input.
 *  - "paused"  — waiting on an approval / sign-off before it can proceed.
 */
export type AgentState = "active" | "idle" | "blocked" | "paused";

export interface AgentActivity {
  status: PresenceStatus;
  /** Short human phrase, e.g. "Running a valuation" or "Idle at desk". */
  label: string;
  busy: boolean;
  /** Emoji for the current activity, shown over the agent's head. */
  glyph: string;
  /** Coarse work-state; richer than `status` for driving avatar affordances. */
  state: AgentState;
  /** One-line current intent (≤60 chars) derived from the latest event. */
  thought?: string;
}

// The activity fields other than `thought`, which varies per event.
type ActivityKind = Omit<AgentActivity, "thought">;

// Tool/event-type → status string + glyph + state. These are the fixed
// "what is this agent doing" buckets; the specific work rides in `thought`.
const EDITING: ActivityKind = {
  status: "focusing",
  label: "Editing files",
  busy: true,
  glyph: "💻",
  state: "active",
};
const RUNNING: ActivityKind = {
  status: "focusing",
  label: "Running a command",
  busy: true,
  glyph: "🔧",
  state: "active",
};
const SEARCHING: ActivityKind = {
  status: "focusing",
  label: "Searching the codebase",
  busy: true,
  glyph: "🔎",
  state: "active",
};
const THINKING: ActivityKind = {
  status: "focusing",
  label: "Thinking it through",
  busy: true,
  glyph: "💭",
  state: "active",
};
const WORKING: ActivityKind = {
  status: "focusing",
  label: "Working",
  busy: true,
  glyph: "🛠",
  state: "active",
};
const WRAPPED: ActivityKind = {
  status: "available",
  label: "Wrapped up a task",
  busy: false,
  glyph: "✅",
  state: "idle",
};
const BLOCKED: ActivityKind = {
  status: "focusing",
  label: "Blocked — needs input",
  busy: false,
  glyph: "⛔",
  state: "blocked",
};
const PAUSED: ActivityKind = {
  status: "focusing",
  label: "Paused — awaiting sign-off",
  busy: false,
  glyph: "⏸️",
  state: "paused",
};

// Keyword rules mapping the live work text to a tool-type bucket, tried in
// order. Roots (not whole words) so "editing"/"drafted"/"parsing" all match.
const WORK_RULES: ReadonlyArray<readonly [RegExp, ActivityKind]> = [
  [/edit|writ|draft|author|compos|updat|format|memo|deck|slide|model|prepar|render|polish|assembl/, EDITING],
  [/run|execut|bash|command|comput|calculat|waterfall|process|deploy|dispatch|trigger|refresh|sync/, RUNNING],
  [/search|grep|\bfind|scan|look|research|sourc|discover|lookup|screen|pars|review|analy|assess|evaluat|monitor|inspect|audit|comps?\b/, SEARCHING],
  [/think|plan|reason|consider|decid|strateg|weigh|brainstorm|ideat|outlin/, THINKING],
];

/** Classify live work text into a tool-type bucket; generic "Working" default. */
function classifyWork(text: string): ActivityKind {
  const t = text.toLowerCase();
  for (const [re, kind] of WORK_RULES) {
    if (re.test(t)) return kind;
  }
  return WORKING;
}

// Text that signals an agent is stalled and waiting on a human/error.
const BLOCKED_TYPE = /block|error|fail|stuck/i;
const BLOCKED_TEXT = /blocked|error|failed|stuck|needs?\s+(input|approval|access|credential|sign)/i;

/** Attach a per-event `thought` to a fixed activity kind. */
function withThought(kind: ActivityKind, thought: string | undefined): AgentActivity {
  return thought ? { ...kind, thought } : { ...kind };
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

// A couple of calm "at rest" glyphs; picked deterministically per agent so the
// office rests with a little variety rather than one repeated emoji.
const RESTING_GLYPHS = ["☕", "🪑"] as const;

/** Deterministic resting glyph for an agent key (no randomness). */
function restingGlyph(agentKey: string): string {
  let hash = 0;
  for (let i = 0; i < agentKey.length; i++) {
    hash = (hash * 31 + agentKey.charCodeAt(i)) | 0;
  }
  return RESTING_GLYPHS[Math.abs(hash) % RESTING_GLYPHS.length];
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
  return { status: "available", label, busy: false, glyph: restingGlyph(agentKey), state: "idle" };
}

/**
 * Clean live work text into a one-line current-intent (≤60 chars), for the
 * `thought` bubble. Returns undefined when there's nothing meaningful to show.
 */
function thoughtFromText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[.…\s]+$/u, "").trim();
  if (!cleaned) return undefined;
  const capped = capitalize(cleaned);
  return capped.length > 60 ? `${capped.slice(0, 59).trimEnd()}…` : capped;
}

/** Safely read the raw string `message` off an event payload (Json is untyped). */
function rawMessageFromPayload(payload: unknown): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

// A live signal for one agent, carrying its recency so the freshest one wins.
interface Signal {
  activity: AgentActivity;
  at: number;
}

/** Parse an ISO timestamp to millis; unparseable/absent sorts oldest. */
function toMillis(ts: string | null | undefined): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Classify a non-terminal task into a live activity (with its `thought`). */
function activityFromTask(task: TaskRow): AgentActivity {
  const thought = thoughtFromText(task.title);
  if (task.status === "blocked") return withThought(BLOCKED, thought);
  if (task.status === "awaiting_approval") return withThought(PAUSED, thought);
  return withThought(classifyWork(task.title ?? ""), thought);
}

/**
 * Classify a single task_event into a live activity, or null when it isn't a
 * signal we surface (e.g. `dispatch.sent`). Maps by event type first, then by
 * the payload message so a "Blocked: …" progress event still reads as blocked.
 */
function activityFromEvent(event: TaskEventRow): AgentActivity | null {
  const type = event.event_type;
  const message = rawMessageFromPayload(event.payload);
  const thought = thoughtFromText(message);

  if (TERMINAL_EVENT_TYPES.has(type)) return withThought(WRAPPED, thought);
  if (BLOCKED_TYPE.test(type) || (message !== null && BLOCKED_TEXT.test(message))) {
    return withThought(BLOCKED, thought);
  }
  if (type === "approval.requested") return withThought(PAUSED, thought);
  if (ACTIVE_EVENT_TYPES.has(type)) return withThought(classifyWork(message ?? ""), thought);
  return null;
}

/**
 * Derive each agent's live activity from recent tasks + task_events.
 *
 * - An in-flight task (non-terminal status) marks its `assigned_agent` working,
 *   classified into a tool-type bucket ("Editing files" 💻, "Running a
 *   command" 🔧, …) from its title, with the title as the one-line `thought`.
 *   A `blocked` task reads ⛔, an `awaiting_approval` task ⏸️.
 * - A recent event, folded per task so a `task.completed` supersedes an earlier
 *   `task.progress`, contributes its own activity: completions read "Wrapped up
 *   a task" ✅ (idle), error/blocked signals ⛔, everything active a tool bucket.
 * - Per agent the freshest signal wins (task then event, later `created_at`).
 * - Every known agent gets an entry with a `glyph` + `state`; agents with no
 *   signal rest via `restingActivity`. Unknown agent keys are ignored.
 *
 * Pure and deterministic: identical inputs always yield identical output.
 */
export function deriveAgentActivity(params: {
  tasks: TaskRow[];
  events: TaskEventRow[];
}): Record<string, AgentActivity> {
  const { tasks, events } = params;
  const known = new Set<string>(AGENTS.map((a) => a.key));
  const signals = new Map<string, Signal>();

  const record = (agentKey: string | null, activity: AgentActivity | null, at: number) => {
    if (!agentKey || !known.has(agentKey) || !activity) return;
    const existing = signals.get(agentKey);
    if (!existing || at >= existing.at) {
      signals.set(agentKey, { activity, at });
    }
  };

  // Tasks: any non-terminal task means its agent is actively on the work.
  for (const task of tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue;
    record(task.assigned_agent, activityFromTask(task), toMillis(task.created_at));
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
    record(event.agent, activityFromEvent(event), toMillis(event.created_at));
  };
  for (const event of latestByTask.values()) consider(event);
  // Events with no task_id can't be superseded; treat each on its own merit.
  for (const event of orphanEvents) consider(event);

  // Build the full map: agents with a live signal first, everyone else resting.
  const out: Record<string, AgentActivity> = {};
  for (const agent of AGENTS) {
    const signal = signals.get(agent.key);
    out[agent.key] = signal ? signal.activity : restingActivity(agent.key);
  }
  return out;
}
