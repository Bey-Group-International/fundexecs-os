// lib/team-tasks.ts
// Team task queue + generalized operator learning. The DB readers/writers are
// thin and best-effort; the prompt/summary helpers are pure and unit-testable.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentKey,
  Database,
  Hub,
  Json,
  OperatorFeedback,
  TaskStatus,
  TeamTask,
  TeamTaskPriority,
} from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const ACTIVE_STATUSES: TaskStatus[] = ["pending", "in_progress", "blocked"];
const PRIORITIES: TeamTaskPriority[] = ["low", "normal", "high", "urgent"];

export interface CreateTeamTaskInput {
  organizationId: string;
  assignedTo: string;
  assignedBy: string;
  title: string;
  description?: string | null;
  hub?: Hub | null;
  module?: string | null;
  priority?: TeamTaskPriority;
  dueAt?: string | null;
  sessionId?: string | null;
  sourceTaskId?: string | null;
  dealId?: string | null;
  assetId?: string | null;
  contextSnapshot?: Json;
}

export interface OperatorFeedbackInput {
  organizationId: string;
  principalId: string | null;
  signal: string;
  subject: string;
  scope?: string | null;
  module?: string | null;
  agent?: AgentKey | string | null;
  taskId?: string | null;
  teamTaskId?: string | null;
  sessionId?: string | null;
  metadata?: Json;
}

interface FeedbackLite {
  signal: string;
  scope: string | null;
  subject: string;
  agent: string | null;
}

function topCounts(values: (string | null | undefined)[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = (value ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key.replace(/[_/]/g, " "));
}

function cleanText(value: string | null | undefined, limit: number): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.slice(0, limit);
}

export function normalizeTeamTaskPriority(raw: string | null | undefined): TeamTaskPriority {
  return PRIORITIES.includes(raw as TeamTaskPriority) ? (raw as TeamTaskPriority) : "normal";
}

export function isActiveTeamTask(task: Pick<TeamTask, "status">): boolean {
  return ACTIVE_STATUSES.includes(task.status);
}

export function summarizeOperatorFeedback(rows: FeedbackLite[]): string {
  if (!rows.length) return "";
  const completed = rows.filter((r) => r.signal === "team_task_completed" || r.signal === "approval_approved");
  const earnAssisted = rows.filter((r) => r.signal === "team_task_earn_assisted");
  const rejected = rows.filter((r) => r.signal === "approval_rejected");

  const parts: string[] = [];
  const scopes = topCounts(completed.map((r) => r.scope), 3);
  if (scopes.length) parts.push(`ships most often in ${scopes.join(", ")}`);
  const agents = topCounts(earnAssisted.map((r) => r.agent), 2);
  if (agents.length) parts.push(`uses Earn with ${agents.join(", ")}`);
  const recentWins = completed.slice(0, 3).map((r) => r.subject).filter(Boolean);
  if (recentWins.length) parts.push(`recently completed ${recentWins.join(", ")}`);
  const skips = topCounts(rejected.map((r) => r.scope), 2);
  if (skips.length) parts.push(`tightens approval in ${skips.join(", ")}`);

  return parts.join("; ");
}

export function operatorLearningPreamble(digest: string | undefined): string {
  return digest ? `[Learned operator pattern: ${digest}.]` : "";
}

export function buildTeamTaskEarnPrompt(task: Pick<TeamTask, "title" | "description" | "hub" | "module" | "priority" | "due_at">): string {
  const context = [
    "You are helping me complete a team task assigned to me.",
    `Task: ${task.title}`,
    task.description ? `Details: ${task.description}` : null,
    task.hub ? `Hub: ${task.hub}${task.module ? ` / ${task.module.replace(/_/g, " ")}` : ""}` : null,
    `Priority: ${task.priority}`,
    task.due_at ? `Due: ${task.due_at}` : null,
    "Plan the fastest credible path to complete it, draft the work product, and call out anything that still needs my approval.",
  ].filter(Boolean);
  return context.join("\n");
}

export async function createTeamTask(supabase: Client, input: CreateTeamTaskInput): Promise<TeamTask | null> {
  const title = cleanText(input.title, 180);
  if (!title) return null;
  try {
    const { data, error } = await supabase
      .from("team_tasks")
      .insert({
        organization_id: input.organizationId,
        assigned_to: input.assignedTo,
        assigned_by: input.assignedBy,
        title,
        description: cleanText(input.description, 1200),
        hub: input.hub ?? null,
        module: cleanText(input.module, 80),
        priority: input.priority ?? "normal",
        due_at: input.dueAt ?? null,
        session_id: input.sessionId ?? null,
        source_task_id: input.sourceTaskId ?? null,
        deal_id: input.dealId ?? null,
        asset_id: input.assetId ?? null,
        context_snapshot: input.contextSnapshot ?? ({} as Json),
      })
      .select("*")
      .single();
    if (error || !data) return null;
    return data as TeamTask;
  } catch {
    return null;
  }
}

export async function listMyTeamTasks(
  supabase: Client,
  orgId: string,
  principalId: string,
  limit = 5,
): Promise<TeamTask[]> {
  try {
    const { data } = await supabase
      .from("team_tasks")
      .select("*")
      .eq("organization_id", orgId)
      .eq("assigned_to", principalId)
      .in("status", ACTIVE_STATUSES)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as TeamTask[];
  } catch {
    return [];
  }
}

export async function getTeamTaskForAssignee(
  supabase: Client,
  orgId: string,
  principalId: string,
  taskId: string,
): Promise<TeamTask | null> {
  try {
    const { data } = await supabase
      .from("team_tasks")
      .select("*")
      .eq("organization_id", orgId)
      .eq("assigned_to", principalId)
      .eq("id", taskId)
      .maybeSingle();
    return (data as TeamTask | null) ?? null;
  } catch {
    return null;
  }
}

export async function updateTeamTaskStatus(
  supabase: Client,
  args: {
    organizationId: string;
    taskId: string;
    status: TaskStatus;
    sessionId?: string | null;
  },
): Promise<boolean> {
  try {
    const completedAt = args.status === "completed" ? new Date().toISOString() : null;
    const patch: Partial<TeamTask> = {
      status: args.status,
      completed_at: completedAt,
    };
    if (args.sessionId !== undefined) patch.session_id = args.sessionId;
    const { error } = await supabase
      .from("team_tasks")
      .update(patch)
      .eq("organization_id", args.organizationId)
      .eq("id", args.taskId);
    return !error;
  } catch {
    return false;
  }
}

export async function recordOperatorFeedback(
  supabase: Client,
  inputs: OperatorFeedbackInput[],
): Promise<number> {
  const rows = inputs
    .filter((input) => input.subject.trim())
    .map((input) => ({
      organization_id: input.organizationId,
      principal_id: input.principalId,
      signal: input.signal,
      subject: input.subject.trim().slice(0, 180),
      scope: cleanText(input.scope, 100),
      module: cleanText(input.module, 100),
      agent: cleanText(input.agent, 80),
      task_id: input.taskId ?? null,
      team_task_id: input.teamTaskId ?? null,
      session_id: input.sessionId ?? null,
      metadata: input.metadata ?? ({} as Json),
    }));
  if (!rows.length) return 0;
  try {
    const { error } = await supabase.from("operator_feedback").insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

export async function getOperatorLearningDigest(
  supabase: Client,
  orgId: string,
  principalId: string | null,
  scope?: string | null,
): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from("operator_feedback")
      .select("signal, scope, subject, agent, principal_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(120);
    const rows = (data ?? []) as Pick<OperatorFeedback, "signal" | "scope" | "subject" | "agent" | "principal_id">[];
    if (!rows.length) return undefined;
    const scoped = scope ? rows.filter((r) => r.scope === scope) : [];
    const mine = principalId ? rows.filter((r) => r.principal_id === principalId) : [];
    const candidates = scoped.length >= 3 ? scoped : mine.length >= 3 ? mine : rows;
    const digest = summarizeOperatorFeedback(candidates);
    return digest || undefined;
  } catch {
    return undefined;
  }
}

export const __test = {
  buildTeamTaskEarnPrompt,
  isActiveTeamTask,
  normalizeTeamTaskPriority,
  operatorLearningPreamble,
  summarizeOperatorFeedback,
  topCounts,
};
