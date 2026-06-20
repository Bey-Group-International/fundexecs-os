"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { gateDecision, type ActionKind } from "@/lib/gates";
import { getActiveMandate } from "@/lib/mandates";
import { dispatchAction } from "@/lib/integrations";
import { recordDispatch } from "@/lib/integrations/log";
import { isEngagingAction, recordEngagement } from "@/lib/engagement";
import type { AgentKey, Json } from "@/lib/supabase/database.types";

// Which executive owns each kind of next action. Determines who the queued task
// is assigned to (and, downstream, which Brain executes it).
const AGENT_FOR_ACTION: Record<ActionKind, AgentKey> = {
  draft_message: "investor_relations",
  draft_memo: "investor_relations",
  update_pipeline: "associate",
  score: "executive_advisor",
  research: "executive_advisor",
  build_list: "executive_advisor",
  draft_reply: "investor_relations",
  create_video_meeting: "associate",
  send_outreach: "rainmaker",
  send_intro_request: "rainmaker",
  share_materials: "investor_relations",
  send_diligence_request: "diligence",
  distribute_report: "investor_relations",
  send_reply: "investor_relations",
  propose_meeting: "associate",
  confirm_booking: "associate",
  sign_document: "associate",
  submit_term_sheet: "associate",
  move_capital: "fund_admin",
  capital_call: "fund_admin",
  execute_subdoc: "associate",
};

export interface QueueActionResult {
  ok: boolean;
  gated?: boolean;
  tier?: 1 | 2 | 3;
  message?: string;
  error?: string;
}

/**
 * Route a Capital Map next-action through the gate layer.
 *
 * Every action becomes a task in the Source hub. The gate decides what happens
 * next: Tier 1 (internal) is queued for Earn to run on its own; Tier 2/3 open an
 * approval the operator must clear before anything reaches the counterparty.
 * Capital movement (Tier 3) can never be auto-executed — the gate enforces it.
 */
export async function queueNextAction(
  investorId: string,
  action: ActionKind,
  label: string,
): Promise<QueueActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const supabase = createServerClient();
  const orgId = auth.ctx.orgId;

  const { data: investor } = await supabase
    .from("investors")
    .select("id, name, contact_email")
    .eq("id", investorId)
    .maybeSingle();
  if (!investor) return { ok: false, error: "Investor not found." };

  // Load the org's active mandate and let it relax the gate: pre-authorized
  // Tier-2 actions run unattended, everything else still needs operator sign-off.
  // Tier 1 is always free and Tier 3 always gated — the gate enforces both
  // regardless of what any mandate claims.
  const mandate = await getActiveMandate(supabase, orgId);
  const decision = gateDecision(action, mandate);

  const title = `${label} — ${investor.name}`;
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      title,
      description: `Capital Map next action for ${investor.name}.`,
      hub: "source",
      assigned_agent: AGENT_FOR_ACTION[action],
      status: decision.requiresApproval ? "awaiting_approval" : "pending",
      progress: 0,
      graph_touched: "relationship",
      requires_approval: decision.requiresApproval,
      created_by: auth.ctx.userId,
      step_order: 0,
    })
    .select("id")
    .single();
  if (error || !task) return { ok: false, error: error?.message ?? "Could not queue action." };

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: task.id,
    event_type: "task.created",
    agent: AGENT_FOR_ACTION[action],
    hub: "source",
    payload: { title, gate_tier: decision.tier } as Json,
  });

  // Relationship feedback loop: deciding to reach a counterparty warms the
  // relationship on the graph, which compounds back into the Capital Map's
  // warmth and intro paths. Internal drafts don't count — only real outreach.
  if (isEngagingAction(action)) {
    await recordEngagement(supabase, { orgId, investorId, action });
  }

  if (decision.requiresApproval) {
    const { data: approval } = await supabase
      .from("approvals")
      .insert({
        organization_id: orgId,
        task_id: task.id,
        requested_by_agent: AGENT_FOR_ACTION[action],
        summary: `Tier ${decision.tier} — ${title}`,
      })
      .select("id")
      .single();

    await supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: task.id,
      event_type: "approval.requested",
      agent: AGENT_FOR_ACTION[action],
      hub: "source",
      payload: { approval_id: approval?.id, gate_tier: decision.tier, summary: title } as Json,
    });

    revalidatePath("/capital-map");
    revalidatePath("/dashboard");

    return {
      ok: true,
      gated: true,
      tier: decision.tier,
      message: `Tier ${decision.tier} — sent to your approvals before it goes out.`,
    };
  }

  // Tier 1 runs free: dispatch it now through the integration layer and close
  // the task. Gated actions instead wait for the operator's approval; once
  // cleared, the approval-decision path calls dispatchAction with the same
  // context (the seam the adapters plug into).
  const result = await dispatchAction({
    orgId,
    actorId: auth.ctx.userId,
    action,
    target: { name: investor.name, email: investor.contact_email ?? undefined },
  });

  // Audit the dispatch (append-only). Keeps dispatchAction itself pure; this is
  // where the DispatchResult becomes a durable record the Outbox surfaces.
  await recordDispatch(supabase, {
    orgId,
    actorId: auth.ctx.userId,
    taskId: task.id,
    action,
    result,
  });

  await supabase
    .from("tasks")
    .update({
      status: result.ok ? "completed" : "failed",
      progress: 1,
      completed_at: new Date().toISOString(),
      result: { dispatch: result } as unknown as Json,
    })
    .eq("id", task.id);

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: task.id,
    event_type: "task.completed",
    agent: AGENT_FOR_ACTION[action],
    hub: "source",
    payload: {
      ok: result.ok,
      channel: result.channel,
      live: result.live,
      detail: result.detail,
    } as Json,
  });

  revalidatePath("/capital-map");
  revalidatePath("/dashboard");

  return {
    ok: result.ok,
    gated: false,
    tier: decision.tier,
    message: result.detail,
    error: result.ok ? undefined : result.error,
  };
}
