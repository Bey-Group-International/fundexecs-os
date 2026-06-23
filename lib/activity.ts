// lib/activity.ts — pure, client-safe activity helpers.
//
// Types, shapers, and display utilities for the cross-hub activity feed.
// No server I/O here — import this file freely from Client Components or tests.
// For the DB aggregator (getActivity) see lib/activity.server.ts.
import type {
  Task,
  Artifact,
  AgentKey,
  Hub,
  TaskStatus,
  ArtifactType,
} from "@/lib/supabase/database.types";

export type ActivityKind = "workflow" | "artifact";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  hub?: Hub;
  agent?: AgentKey;
  status: TaskStatus;
  sessionId?: string;
  when: string; // ISO timestamp, used for sorting + display
  summary?: string;
}

export interface ActivityDayGroup {
  /** ISO date key (YYYY-MM-DD) for the bucket. */
  day: string;
  /** Human label for the heading: "Today", "Yesterday", or a date. */
  label: string;
  entries: ActivityEntry[];
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to import directly in tests)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** A relative-time label: "just now", "2h ago", "yesterday", "3d ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now.getTime() - then;
  if (diff < 0) return "just now";

  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Stable YYYY-MM-DD key in local time for a date. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human heading for a day bucket relative to `now`. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - DAY_MS));
  const key = dayKey(then);
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return then.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Bucket entries under day headings, newest day first and newest entry first
 * within each day. Entries with an unparseable `when` are dropped.
 */
export function groupByDay(
  entries: ActivityEntry[],
  now: Date = new Date(),
): ActivityDayGroup[] {
  const buckets = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const d = new Date(entry.when);
    if (Number.isNaN(d.getTime())) continue;
    const key = dayKey(d);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)) // newest day first
    .map(([day, list]) => ({
      day,
      label: dayLabel(list[0].when, now),
      entries: list
        .slice()
        .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()),
    }));
}

export type StatusTone = "active" | "pending" | "done" | "blocked" | "muted";

/** Map a task status to a coarse visual tone for status pills. */
export function statusTone(status: TaskStatus): StatusTone {
  switch (status) {
    case "in_progress":
      return "active";
    case "awaiting_approval":
    case "pending":
      return "pending";
    case "completed":
      return "done";
    case "failed":
    case "blocked":
      return "blocked";
    case "cancelled":
    default:
      return "muted";
  }
}

/** Human label for a status pill (e.g. "awaiting_approval" → "Awaiting approval"). */
export function statusLabel(status: TaskStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

/** Human label for an artifact type (e.g. "ic_memo" → "IC memo"). */
export function artifactTypeLabel(type: ArtifactType): string {
  if (type === "ic_memo") return "IC memo";
  if (type === "lp_update") return "LP update";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}

/**
 * Guard against task descriptions that contain internal system-prompt prefixes
 * or raw user instructions being surfaced in the public activity feed. These
 * strings should never appear as visible copy — if they do, suppress the summary
 * rather than leaking them.
 */
function isInternalPrompt(text: string): boolean {
  return (
    text.includes("[Selected reasoning engine:") ||
    text.startsWith("You are ") ||
    text.startsWith("You're ") ||
    // Bare imperative user prompts (no leading bracket or period) are also
    // suppressed — they read as instructions, not as activity descriptions.
    /^(Im |I'm |I am |Use the browser|Find |Source |Reach out|Run |Build |Draft |Create |Generate |Search |Pull |Scan |Analyze )/i.test(text)
  );
}

/** Shape a parent workflow Task into an ActivityEntry. */
export function workflowToEntry(task: Task): ActivityEntry {
  const raw = task.description?.trim();
  // Only surface the description as a summary when it reads as a human-written
  // task description, not as an internal prompt or a raw user instruction that
  // was inadvertently stored in the column.
  const summary = raw && !isInternalPrompt(raw) ? raw : undefined;
  return {
    id: `task:${task.id}`,
    kind: "workflow",
    title: task.title,
    hub: task.hub,
    agent: task.assigned_agent,
    status: task.status,
    sessionId: task.session_id ?? undefined,
    when: task.completed_at ?? task.updated_at ?? task.created_at,
    summary,
  };
}

/**
 * Shape an artifact into an ActivityEntry. Artifacts are always finished
 * deliverables, so they carry a "completed" status for tone purposes. The
 * session id is threaded in from the parent workflow when known.
 */
export function artifactToEntry(
  artifact: Artifact,
  sessionByWorkflow: Map<string, string | null>,
): ActivityEntry {
  const sessionId = artifact.workflow_id
    ? sessionByWorkflow.get(artifact.workflow_id) ?? null
    : null;
  return {
    id: `artifact:${artifact.id}`,
    kind: "artifact",
    title: artifact.title,
    hub: artifact.hub ?? undefined,
    agent: artifact.agent ?? undefined,
    status: "completed",
    sessionId: sessionId ?? undefined,
    when: artifact.created_at,
    summary: artifactTypeLabel(artifact.artifact_type),
  };
}

/** Merge workflow + artifact entries into one newest-first, bounded timeline. */
export function mergeTimeline(
  workflows: ActivityEntry[],
  artifacts: ActivityEntry[],
  limit: number,
): ActivityEntry[] {
  return [...workflows, ...artifacts]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, limit);
}

