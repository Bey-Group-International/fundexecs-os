"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { getMandate } from "@/lib/build-readiness";
import {
  planTriage,
  scorePipeline as scorePipelineEngine,
  sourceConfigFor,
  type PipelineScore,
  type SourcingMandate,
} from "@/lib/source-ai";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey, Json } from "@/lib/supabase/database.types";

async function loadMandate(orgId: string): Promise<SourcingMandate | null> {
  const m = await getMandate(orgId);
  if (!m) return null;
  return {
    thesisTitle: m.thesisTitle,
    assetClasses: m.assetClasses,
    geographies: m.geographies,
    checkSizeMin: m.checkSizeMin,
    checkSizeMax: m.checkSizeMax,
    targetIrr: m.targetIrr,
    targetMoic: m.targetMoic,
  };
}

// A triaged module group: the owning agent's ranked read on its live rows, plus
// a per-id contact email so the UI can queue the act step through the gate.
export interface TriageGroup {
  module: string; // full key, e.g. "source/lp_pipeline"
  entities: string; // plural noun for the label, e.g. "LPs"
  agent: AgentKey;
  agentName: string;
  scores: PipelineScore[];
  /** Map of row id → contact email (when present) for the queued action. */
  rowEmail: Record<string, string>;
}

export interface RunTriageResult {
  ok: boolean;
  summary?: string;
  groups?: TriageGroup[];
  error?: string;
}

// Earn triages the EXISTING pipeline: plan which Source modules the request
// implies, load each module's live rows, score + rank them against the mandate,
// and mirror a session + workflow + task_events so the run shows in the session
// theater. The act step reuses queueSourceAction (the gate) from the client.
export async function runTriage(prompt: string): Promise<RunTriageResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const clean = String(prompt ?? "").trim().slice(0, 500);
  if (!clean) return { ok: false, error: "Describe what you want to triage." };

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();
  const mandate = await loadMandate(orgId);
  const plan = await planTriage(clean, mandate);
  if (!plan.modules.length) return { ok: false, error: "Couldn't plan that triage." };

  // Session + workflow so the triage shows in the session theater (mirrors
  // source-search-actions' insert shapes).
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
      description: `Pipeline triage: ${clean}`,
      hub: "source",
      assigned_agent: "associate",
      status: "in_progress",
      progress: 0.05,
      graph_touched: "relationship",
      requires_approval: false,
      created_by: auth.ctx.userId,
      step_order: 0,
      session_id: sessionId,
    })
    .select("id")
    .single();
  if (error || !workflow) return { ok: false, error: error?.message ?? "Could not start the triage." };
  const workflowId = workflow.id;

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: workflowId,
    event_type: "task.created",
    agent: "associate",
    hub: "source",
    payload: { title: plan.summary || clean, modules: plan.modules.length } as Json,
  });

  const groups: TriageGroup[] = [];
  for (let i = 0; i < plan.modules.length; i++) {
    const moduleKey = plan.modules[i];
    const cfg = sourceConfigFor(moduleKey);
    if (!cfg) continue;

    // Stage one (pending) task per module so the run reads in the theater.
    const { data: stepTask } = await supabase
      .from("tasks")
      .insert({
        organization_id: orgId,
        parent_task_id: workflowId,
        title: `Triage ${cfg.entities}`,
        description: clean,
        hub: "source",
        assigned_agent: cfg.agent,
        status: "in_progress",
        progress: 0.5,
        graph_touched: "relationship",
        requires_approval: false,
        created_by: auth.ctx.userId,
        step_order: i + 1,
        session_id: sessionId,
      })
      .select("id")
      .single();

    const { data } = await supabase
      .from(cfg.table as "investors")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    const records = (data ?? []) as unknown as Record<string, unknown>[];
    const rows = records.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Unnamed"),
      fields: r,
    }));

    const rowEmail: Record<string, string> = {};
    for (const r of records) {
      const email = r.contact_email;
      if (typeof email === "string" && email.trim()) rowEmail[String(r.id)] = email.trim();
    }

    const scores = rows.length ? await scorePipelineEngine(moduleKey, mandate, rows) : [];

    if (stepTask?.id) {
      await supabase
        .from("tasks")
        .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
        .eq("id", stepTask.id);
    }
    await supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: workflowId,
      event_type: "task.completed",
      agent: cfg.agent,
      hub: "source",
      payload: { step_id: stepTask?.id ?? null, module: moduleKey, scored: scores.length } as Json,
    });

    groups.push({
      module: moduleKey,
      entities: cfg.entities,
      agent: cfg.agent,
      agentName: AGENT_BY_KEY[cfg.agent]?.name ?? "Agent",
      scores,
      rowEmail,
    });
  }

  await supabase
    .from("tasks")
    .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
    .eq("id", workflowId);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: workflowId,
    event_type: "task.completed",
    agent: "associate",
    hub: "source",
    payload: { message: "Triage complete." } as Json,
  });

  revalidatePath("/source/triage");
  revalidatePath("/dashboard");

  return { ok: true, summary: plan.summary, groups };
}
