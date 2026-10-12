// lib/inbox/approval-sweep.server.ts
// The hourly sweep for inbox messages held for approval, and for approved ones
// scheduled to go out later.
//
//   1. Reminders. A message waiting APPROVAL_REMIND_HOURS gets a team task for
//      the people who can approve it — owners and admins first, else members —
//      never its author, who may not. One waiting APPROVAL_ESCALATE_HOURS gets
//      a high-priority one for the owners, and the inbox lists it first.
//      Each is sent once per approval (recorded on the task), and a message
//      revised or re-opened starts again.
//   2. Scheduled sends. An approved message whose time has come is delivered
//      exactly as an immediate approval would deliver it.
//
// Service role, across organisations, capped per tick. Never throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createTeamTask } from "@/lib/team-tasks";
import { deliverApprovedReply } from "@/lib/inbox/deliver-reply.server";
import {
  APPROVAL_ESCALATE_HOURS,
  APPROVAL_REMIND_HOURS,
  extractInboxReply,
} from "@/lib/inbox/pending-action";

type Client = SupabaseClient<Database>;

const CAP = 50;
const MAX_APPROVERS = 3;

export interface ApprovalSweepStats {
  reminded: number;
  escalated: number;
  sent: number;
  failed: number;
}

interface Reminders {
  remindedAt?: string | null;
  escalatedAt?: string | null;
}

/** Which reminder (if any) a message is due, given how long it has waited. Pure. */
export function reminderDue(
  waitingSince: string,
  sent: Reminders,
  now: Date,
): "remind" | "escalate" | null {
  const waited = now.getTime() - Date.parse(waitingSince);
  if (!Number.isFinite(waited)) return null;
  if (waited >= APPROVAL_ESCALATE_HOURS * 3_600_000 && !sent.escalatedAt) return "escalate";
  if (waited >= APPROVAL_REMIND_HOURS * 3_600_000 && !sent.remindedAt && !sent.escalatedAt) return "remind";
  return null;
}

/** Who to remind: owners/admins first, else members — never the author; owners only for an escalation. */
export function pickApprovers(
  members: ReadonlyArray<{ principal_id: string; role: string }>,
  authorId: string,
  kind: "remind" | "escalate",
): string[] {
  const others = members.filter((m) => m.principal_id !== authorId);
  const ranked =
    kind === "escalate"
      ? others.filter((m) => m.role === "owner")
      : [
          ...others.filter((m) => m.role === "owner" || m.role === "admin"),
          ...others.filter((m) => m.role === "member"),
        ];
  return [...new Set(ranked.map((m) => m.principal_id))].slice(0, MAX_APPROVERS);
}

async function sweepReminders(client: Client, now: Date, stats: ApprovalSweepStats) {
  const since = new Date(now.getTime() - APPROVAL_REMIND_HOURS * 3_600_000).toISOString();
  const { data: approvals } = await client
    .from("approvals")
    .select("task_id, organization_id, created_at")
    .eq("decision", "pending")
    .lte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(CAP * 4);
  const pending = (approvals ?? []) as Array<{ task_id: string; organization_id: string; created_at: string }>;
  if (!pending.length) return;

  const { data: taskRows } = await client
    .from("tasks")
    .select("id, title, status, result, organization_id")
    .in("id", [...new Set(pending.map((a) => a.task_id))])
    .eq("status", "awaiting_approval");
  const tasks = new Map(
    ((taskRows ?? []) as Array<{ id: string; title: string; status: string; result: unknown; organization_id: string }>).map((t) => [t.id, t]),
  );

  const membersByOrg = new Map<string, Array<{ principal_id: string; role: string }>>();
  let handled = 0;
  for (const a of pending) {
    if (handled >= CAP) break;
    const task = tasks.get(a.task_id);
    const reply = task ? extractInboxReply(task.result) : null;
    if (!task || !reply) continue;
    const result = (task.result && typeof task.result === "object" ? task.result : {}) as Record<string, unknown>;
    const sent = (result.approvalReminders ?? {}) as Reminders;
    const due = reminderDue(a.created_at, sent, now);
    if (!due) continue;

    if (!membersByOrg.has(task.organization_id)) {
      const { data } = await client
        .from("organization_members")
        .select("principal_id, role")
        .eq("organization_id", task.organization_id);
      membersByOrg.set(task.organization_id, (data ?? []) as Array<{ principal_id: string; role: string }>);
    }
    const approvers = pickApprovers(membersByOrg.get(task.organization_id)!, reply.senderId, due);
    handled++;
    // Recorded first, so a failure below never sends the same reminder every hour.
    const stamp = now.toISOString();
    await client
      .from("tasks")
      .update({
        result: {
          ...result,
          approvalReminders: due === "escalate" ? { ...sent, escalatedAt: stamp } : { ...sent, remindedAt: stamp },
        } as unknown as Json,
      })
      .eq("id", task.id);
    for (const to of approvers) {
      await createTeamTask(client, {
        organizationId: task.organization_id,
        assignedTo: to,
        assignedBy: reply.senderId,
        title: due === "escalate" ? `Approval waiting 1 day: ${task.title}` : `Approval waiting: ${task.title}`,
        description:
          due === "escalate"
            ? `An outbound message has waited ${APPROVAL_ESCALATE_HOURS} hours for approval. Review it in the inbox: /inbox`
            : `An outbound message is waiting for your approval. Review it in the inbox: /inbox`,
        module: "inbox",
        priority: due === "escalate" ? "high" : "normal",
        sourceTaskId: task.id,
        contextSnapshot: { source: "approval_sweep", reason: due, task_id: task.id } as Json,
      });
    }
    if (due === "escalate") stats.escalated++;
    else stats.reminded++;
  }
}

async function sweepScheduledSends(client: Client, now: Date, stats: ApprovalSweepStats) {
  const { data } = await client
    .from("tasks")
    .select("id, organization_id, result, assigned_agent, hub")
    .eq("status", "pending")
    .not("result->inboxReply->scheduledAt", "is", null)
    .lte("result->inboxReply->>scheduledAt", now.toISOString())
    .limit(CAP);
  for (const t of (data ?? []) as Array<{ id: string; organization_id: string; result: unknown; assigned_agent: string | null; hub: string | null }>) {
    const reply = extractInboxReply(t.result);
    if (!reply?.scheduledAt || reply.delivered) continue;
    const r = await deliverApprovedReply(client, {
      orgId: t.organization_id,
      approverId: reply.approvedBy ?? reply.senderId,
      taskId: t.id,
      agent: (t.assigned_agent as never) ?? null,
      hub: t.hub,
      reply: { ...reply, scheduledAt: null },
    });
    if (r.ok) stats.sent++;
    else stats.failed++;
  }
}

export async function runInboxApprovalSweep(client: Client, now: Date = new Date()): Promise<ApprovalSweepStats> {
  const stats: ApprovalSweepStats = { reminded: 0, escalated: 0, sent: 0, failed: 0 };
  try {
    await sweepScheduledSends(client, now, stats);
  } catch (e) {
    console.error("[inbox/approval-sweep] scheduled sends failed", e);
  }
  try {
    await sweepReminders(client, now, stats);
  } catch (e) {
    console.error("[inbox/approval-sweep] reminders failed", e);
  }
  return stats;
}
