"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt, decideApproval } from "@/lib/engine";
import { getActiveMandate } from "@/lib/mandates";
import type { Mandate } from "@/lib/gates";
import {
  copilotContextFromPath,
  contextPreamble,
  suggestionsFor,
  willAutoRun,
  type CopilotContext,
  type CopilotSuggestion,
} from "@/lib/copilot";
import { getBuildReadiness } from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";
import {
  buildTeamTaskEarnPrompt,
  getOperatorLearningDigest,
  getTeamTaskForAssignee,
  listMyTeamTasks,
  operatorLearningPreamble,
  recordOperatorFeedback,
  updateTeamTaskStatus,
} from "@/lib/team-tasks";
import type { AgentKey, Task, Approval, TaskStatus, TeamTask } from "@/lib/supabase/database.types";

export interface AskEarnResult {
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  steps?: { agent: AgentKey; title: string }[];
  error?: string;
}

// Plan a free-form ask against the operator's current location. Returns a
// summary of the routed plan (which specialists Earn delegated to) for inline
// display in the dock, with a deep link into the full session. The standing
// approval loop still gates any outward action the plan proposes.
export async function askEarn(input: {
  body: string;
  pathname: string;
  /** When set, the ask continues this session as a multi-turn conversation. */
  sessionId?: string;
}): Promise<AskEarnResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  if (!body) return { ok: false, error: "Ask Earn something first." };

  const location = copilotContextFromPath(input.pathname);
  const supabase = createServerClient();
  try {
    const learned = await getOperatorLearningDigest(supabase, ctx.orgId, ctx.userId, location.scope);
    const learnedBlock = operatorLearningPreamble(learned);
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      `${contextPreamble(location)} ${learnedBlock} ${body}`,
      input.sessionId,
    );
    return {
      ok: true,
      sessionId: result.session_id,
      planTitle: result.plan.title,
      steps: result.plan.steps.map((s) => ({ agent: s.agent, title: s.title })),
    };
  } catch {
    return { ok: false, error: "Earn couldn't plan that just now. Try again." };
  }
}

/** Resolve a suggestion by id within a given location. */
function findSuggestion(loc: CopilotContext, id: string): CopilotSuggestion | null {
  return suggestionsFor(loc).find((s) => s.id === id) ?? null;
}

/** The org's active standing mandate, for showing what Earn may auto-run. */
export async function getMandateSummary(): Promise<Mandate | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const supabase = createServerClient();
  return (await getActiveMandate(supabase, ctx.orgId)) ?? null;
}

// Launch a pre-baked, context-aware suggestion. Plans the templated prompt,
// then — when the standing mandate authorizes it (internal Tier-1 work, or a
// Tier-2 action pre-approved within the ceiling) — auto-approves and runs the
// workflow proactively. Otherwise it lands in the session awaiting the
// operator's sign-off. Either way, opens the session.
export async function launchCopilotSuggestion(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const pathname = String(formData.get("pathname") ?? "/");
  const id = String(formData.get("suggestion_id") ?? "");
  const loc = copilotContextFromPath(pathname);
  const suggestion = findSuggestion(loc, id);
  if (!suggestion) redirect("/workspace");

  const supabase = createServerClient();
  const engineCtx = { supabase, orgId: ctx.orgId, actorId: ctx.userId };
  const result = await handlePrompt(engineCtx, `${contextPreamble(loc)} ${suggestion.prompt}`);

  // Proactive execution — gated by the standing mandate, never above Tier 2.
  if (result.approval_id) {
    const mandate = await getActiveMandate(supabase, ctx.orgId);
    if (willAutoRun(suggestion, mandate)) {
      try {
        await decideApproval(engineCtx, { approvalId: result.approval_id, decision: "approved" });
      } catch {
        // If auto-execution fails, the workflow simply remains awaiting approval.
      }
    }
  }

  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}

// --- Recent runs -----------------------------------------------------------
// The dock's "Recent runs" feed: the org's most recent copilot workflows so the
// operator can review/approve results at a glance — closing the loop on
// proactive auto-execution.
export interface RunSummary {
  sessionId: string | null;
  title: string;
  status: TaskStatus;
  createdAt: string;
  /** Pending approval id for a workflow still awaiting the operator's sign-off. */
  approvalId?: string;
}

/**
 * The org's most recent parent workflows (newest first, ~6), each with its
 * pending approval id resolved when it's still awaiting approval. Best-effort:
 * returns [] on any error so the dock degrades gracefully.
 */
export async function getRecentRuns(): Promise<RunSummary[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = createServerClient();

  try {
    const { data: workflows } = await supabase
      .from("tasks")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .order("created_at", { ascending: false })
      .limit(6);
    const list = (workflows ?? []) as Task[];
    if (list.length === 0) return [];

    // Resolve pending approvals only for workflows still awaiting sign-off.
    const awaitingIds = list.filter((w) => w.status === "awaiting_approval").map((w) => w.id);
    let approvalByTask = new Map<string, string>();
    if (awaitingIds.length > 0) {
      const { data: approvals } = await supabase
        .from("approvals")
        .select("id, task_id, decision")
        .in("task_id", awaitingIds)
        .eq("decision", "pending");
      approvalByTask = new Map(
        ((approvals ?? []) as Pick<Approval, "id" | "task_id" | "decision">[]).map((a) => [
          a.task_id,
          a.id,
        ]),
      );
    }

    return list.map((w) => ({
      sessionId: w.session_id,
      title: w.title,
      status: w.status,
      createdAt: w.created_at,
      approvalId: approvalByTask.get(w.id),
    }));
  } catch {
    return [];
  }
}

// --- Personal team tasks ----------------------------------------------------
export interface TeamTaskSummary {
  id: string;
  title: string;
  description: string | null;
  hub: string | null;
  module: string | null;
  status: TaskStatus;
  priority: string;
  dueAt: string | null;
  sessionId: string | null;
}

function taskSummary(t: TeamTask): TeamTaskSummary {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    hub: t.hub,
    module: t.module,
    status: t.status,
    priority: t.priority,
    dueAt: t.due_at,
    sessionId: t.session_id,
  };
}

/** Principal-scoped queue surfaced in the Earn dock. */
export async function getMyTeamTasks(): Promise<TeamTaskSummary[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = createServerClient();
  const tasks = await listMyTeamTasks(supabase, ctx.orgId, ctx.userId, 5);
  return tasks.map(taskSummary);
}

/** Mark a personal task complete from the dock. */
export async function completeMyTeamTask(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const taskId = String(formData.get("team_task_id") ?? "").trim();
  if (!taskId) return;
  const supabase = createServerClient();
  const task = await getTeamTaskForAssignee(supabase, ctx.orgId, ctx.userId, taskId);
  if (!task) return;
  const ok = await updateTeamTaskStatus(supabase, {
    organizationId: ctx.orgId,
    taskId,
    status: "completed",
  });
  if (ok) {
    await recordOperatorFeedback(supabase, [
      {
        organizationId: ctx.orgId,
        principalId: ctx.userId,
        signal: "team_task_completed",
        subject: task.title,
        scope: task.hub && task.module ? `${task.hub}/${task.module}` : task.hub,
        module: task.module,
        teamTaskId: task.id,
        sessionId: task.session_id,
      },
    ]);
  }
}

/** Launch a personal task through Earn and open the full session. */
export async function launchTeamTaskWithEarn(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const taskId = String(formData.get("team_task_id") ?? "").trim();
  const pathname = String(formData.get("pathname") ?? "/");
  if (!taskId) redirect("/workspace");

  const supabase = createServerClient();
  const task = await getTeamTaskForAssignee(supabase, ctx.orgId, ctx.userId, taskId);
  if (!task) redirect("/workspace");

  const location = copilotContextFromPath(pathname);
  const learned = await getOperatorLearningDigest(supabase, ctx.orgId, ctx.userId, location.scope);
  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    `${contextPreamble(location)} ${operatorLearningPreamble(learned)} ${buildTeamTaskEarnPrompt(task)}`,
    task.session_id ?? undefined,
  );

  await updateTeamTaskStatus(supabase, {
    organizationId: ctx.orgId,
    taskId: task.id,
    status: "in_progress",
    sessionId: result.session_id,
  });
  await recordOperatorFeedback(supabase, [
    {
      organizationId: ctx.orgId,
      principalId: ctx.userId,
      signal: "team_task_earn_assisted",
      subject: task.title,
      scope: task.hub && task.module ? `${task.hub}/${task.module}` : task.hub,
      module: task.module,
      agent: "associate",
      teamTaskId: task.id,
      taskId: result.workflow.id,
      sessionId: result.session_id,
    },
  ]);

  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}

/** Approve a run from the dock's feed — runs the workflow end-to-end. No-op if missing. */
export async function approveRun(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const approvalId = String(formData.get("approval_id") ?? "");
  if (!approvalId) return;
  const supabase = createServerClient();
  try {
    await decideApproval(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      { approvalId, decision: "approved" },
    );
    await recordOperatorFeedback(supabase, [
      {
        organizationId: ctx.orgId,
        principalId: ctx.userId,
        signal: "approval_approved",
        subject: "Earn run approved",
        scope: "dock/recent_runs",
        agent: "associate",
      },
    ]);
  } catch {
    // Best-effort: the dock re-fetches and the run simply stays awaiting approval.
  }
}

/** Dismiss (reject) a run from the dock's feed. No-op if missing. */
export async function dismissRun(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const approvalId = String(formData.get("approval_id") ?? "");
  if (!approvalId) return;
  const supabase = createServerClient();
  try {
    await decideApproval(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      { approvalId, decision: "rejected" },
    );
    await recordOperatorFeedback(supabase, [
      {
        organizationId: ctx.orgId,
        principalId: ctx.userId,
        signal: "approval_rejected",
        subject: "Earn run rejected",
        scope: "dock/recent_runs",
        agent: "associate",
      },
    ]);
  } catch {
    // Best-effort: ignore and let the dock re-fetch.
  }
}

// --- Live briefing ---------------------------------------------------------
export interface BriefingStat {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}
export interface CopilotBriefing {
  headline: string;
  stats: BriefingStat[];
  nextAction: { label: string; prompt: string } | null;
}

/** Format a 0–100 score as a rounded percentage string. */
function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// Read the firm's live state for the operator's current hub and distill it into
// a one-line headline, a few signal chips, and the single next-best action —
// reusing the same readiness/conviction/performance engines the hub pages do.
export async function getCopilotBriefing(pathname: string): Promise<CopilotBriefing | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const hub = copilotContextFromPath(pathname).hub;
  const orgId = ctx.orgId;

  try {
    if (hub === "build") {
      const r = await getBuildReadiness(orgId);
      return {
        headline: `${pct(r.overall)} foundation · ${r.stage.label}`,
        stats: [{ label: "Readiness", value: pct(r.overall), tone: r.overall >= 85 ? "good" : "warn" }],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this next step and draft it: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "run") {
      const r = await getRunConviction(orgId);
      const b = r.benchmark;
      return {
        headline: b.dealsInEval
          ? `${b.dealsInEval} ${b.dealsInEval === 1 ? "deal" : "deals"} in evaluation · ${pct(r.overall)} conviction`
          : "No deals in evaluation yet",
        stats: [
          { label: "Conviction", value: pct(r.overall), tone: r.overall >= 65 ? "good" : "warn" },
          { label: "IC-ready", value: String(b.icReadyCount), tone: b.icReadyCount > 0 ? "good" : undefined },
          {
            label: "Open critical risk",
            value: String(b.openCriticalRisks),
            tone: b.openCriticalRisks === 0 ? "good" : "bad",
          },
        ],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me take the next step on ${r.nextAction.dealName}: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "source") {
      const r = await getSourceMomentum(orgId);
      return {
        headline: `${pct(r.overall)} raise readiness · ${r.stage.label}`,
        stats: [{ label: "Raise readiness", value: pct(r.overall), tone: r.overall >= 65 ? "good" : "warn" }],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this next step on the raise: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "execute") {
      const r = await getExecutePerformance(orgId);
      const hero = r.heroMultiple != null ? `${r.heroMultiple.toFixed(2)}x ${r.heroLabel}` : "No marks yet";
      return {
        headline: `${r.stage.label} · ${hero}`,
        stats: [
          { label: r.heroLabel, value: r.heroMultiple != null ? `${r.heroMultiple.toFixed(2)}x` : "—" },
          { label: "Active assets", value: String(r.activeAssets) },
        ],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this portfolio step: ${r.nextAction.label}` }
          : null,
      };
    }

    // Off-hub (dashboard/workspace): a cross-hub one-liner from the two
    // strongest signals.
    const [build, run] = await Promise.all([getBuildReadiness(orgId), getRunConviction(orgId)]);
    return {
      headline: `${pct(build.overall)} foundation · ${run.benchmark.dealsInEval} in evaluation`,
      stats: [
        { label: "Foundation", value: pct(build.overall) },
        { label: "Conviction", value: pct(run.overall) },
      ],
      nextAction: run.nextAction
        ? { label: run.nextAction.label, prompt: `What's the highest-leverage thing to do next? Specifically: ${run.nextAction.label}` }
        : build.nextAction
          ? { label: build.nextAction.label, prompt: `Help me with this next step: ${build.nextAction.label}` }
          : null,
    };
  } catch {
    return null;
  }
}
