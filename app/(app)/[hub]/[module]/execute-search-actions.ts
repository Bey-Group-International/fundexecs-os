"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { planExecuteSearch } from "@/lib/execute-search";
import { executeStep } from "@/lib/claude";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey, Json } from "@/lib/supabase/database.types";

// A planned step enriched with display metadata so the client never needs the
// (Anthropic-importing) engine module.
export interface ExecuteStep {
  id: string;
  agent: AgentKey;
  agentName: string;
  title: string;
  instruction: string;
}

export interface StartExecuteResult {
  ok: boolean;
  sessionId?: string | null;
  workflowId?: string;
  summary?: string;
  steps?: ExecuteStep[];
  error?: string;
}

// Earn briefs the Execute team: plan the request, open a session + workflow, and
// stage one (pending) task per agent step. The client then runs the steps, which
// stream the live timeline and return synthesized deliverables.
export async function startExecuteSearch(prompt: string): Promise<StartExecuteResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const clean = String(prompt ?? "").trim().slice(0, 500);
  if (!clean) return { ok: false, error: "Describe the operations work you need." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();
  const plan = await planExecuteSearch(clean);
  if (!plan.steps.length) return { ok: false, error: "Couldn't plan that request." };

  const { data: session } = await supabase
    .from("sessions")
    .insert({ organization_id: orgId, name: clean.slice(0, 120), origin: "earn", created_by: auth.ctx.userId })
    .select("id")
    .single();
  const sessionId = session?.id ?? null;

  const { data: workflow, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      title: plan.summary || clean,
      description: `Execute ops: ${clean}`,
      hub: "execute",
      assigned_agent: "associate",
      status: "in_progress",
      progress: 0.05,
      graph_touched: "capital",
      requires_approval: false,
      created_by: auth.ctx.userId,
      step_order: 0,
      session_id: sessionId,
    })
    .select("id")
    .single();
  if (error || !workflow) return { ok: false, error: error?.message ?? "Could not start the workflow." };
  const workflowId = workflow.id;

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: workflowId,
    event_type: "task.created",
    agent: "associate",
    hub: "execute",
    payload: { title: plan.summary || clean, steps: plan.steps.length } as Json,
  });

  const steps: ExecuteStep[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const { data: stepTask } = await supabase
      .from("tasks")
      .insert({
        organization_id: orgId,
        parent_task_id: workflowId,
        title: s.title,
        description: s.instruction,
        hub: "execute",
        assigned_agent: s.agent,
        status: "pending",
        progress: 0,
        graph_touched: "capital",
        requires_approval: false,
        created_by: auth.ctx.userId,
        step_order: i + 1,
        session_id: sessionId,
      })
      .select("id")
      .single();
    if (stepTask?.id) {
      steps.push({
        id: stepTask.id,
        agent: s.agent,
        agentName: AGENT_BY_KEY[s.agent]?.name ?? "Agent",
        title: s.title,
        instruction: s.instruction,
      });
    }
  }

  return { ok: true, sessionId, workflowId, summary: plan.summary, steps };
}

export interface RunStepResult {
  ok: boolean;
  deliverable?: string;
  error?: string;
}

// Execute one agent step: stream progress, synthesize the deliverable, and close
// the task. Returns the deliverable text for the live results.
export async function runExecuteStep(args: {
  workflowId: string;
  stepId: string;
  agent: AgentKey;
  title: string;
  instruction: string;
}): Promise<RunStepResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  await supabase.from("tasks").update({ status: "in_progress", progress: 0.5 }).eq("id", args.stepId);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: args.workflowId,
    event_type: "task.progress",
    agent: args.agent,
    hub: "execute",
    payload: { step_id: args.stepId, message: `${AGENT_BY_KEY[args.agent]?.name ?? "Agent"} working…` } as Json,
  });

  const deliverable = await executeStep({
    workflowTitle: args.title,
    agent: args.agent,
    stepTitle: args.title,
    stepDescription: args.instruction,
    priorOutputs: [],
  });

  await supabase
    .from("tasks")
    .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
    .eq("id", args.stepId);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: args.workflowId,
    event_type: "task.completed",
    agent: args.agent,
    hub: "execute",
    payload: { step_id: args.stepId } as Json,
  });

  return { ok: true, deliverable };
}

// Mark the workflow complete once the client has run every step.
export async function completeExecuteSearch(workflowId: string): Promise<{ ok: boolean }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = await createServerClient();
  await supabase
    .from("tasks")
    .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
    .eq("id", workflowId);
  await supabase.from("task_events").insert({
    organization_id: auth.ctx.orgId,
    task_id: workflowId,
    event_type: "task.completed",
    agent: "associate",
    hub: "execute",
    payload: { message: "Ops workflow complete." } as Json,
  });
  revalidatePath("/execute/search");
  revalidatePath("/dashboard");
  return { ok: true };
}
