"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { gateDecision, type ActionKind } from "@/lib/gates";
import { isVerifiable } from "@/lib/grounding";
import { getActiveMandate } from "@/lib/mandates";
import { dispatchAction } from "@/lib/integrations";
import { recordDispatch } from "@/lib/integrations/log";
import { computePriority, fallbackSummary } from "@/lib/inbox/intelligence";
import { INBOX_CHANNELS } from "@/lib/inbox/channels";
import type {
  AgentKey,
  InboxCategory,
  InboxChannel,
  InboxThread,
  Json,
} from "@/lib/supabase/database.types";

// Which executive owns each inbox-originated action — determines who the queued
// task is assigned to (and which Brain executes it once approved).
const AGENT_FOR_INBOX_ACTION: Partial<Record<ActionKind, AgentKey>> = {
  send_reply: "investor_relations",
  propose_meeting: "associate",
  confirm_booking: "associate",
  create_video_meeting: "associate",
  share_materials: "investor_relations",
};

// The inbox-originated actions a thread row may trigger from its suggested move.
const THREAD_ACTIONS: ActionKind[] = [
  "send_reply",
  "propose_meeting",
  "confirm_booking",
  "create_video_meeting",
];

const ACTION_LABEL: Partial<Record<ActionKind, string>> = {
  send_reply: "Reply",
  propose_meeting: "Propose a time",
  confirm_booking: "Confirm booking",
  create_video_meeting: "Create meeting link",
  share_materials: "Share Command Center details",
};

export interface ThreadActionResult {
  ok: boolean;
  gated?: boolean;
  tier?: 1 | 2 | 3;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Core: route an inbox action through the gate layer + dispatch loop.
//
// Mirrors app/(app)/capital-map/actions.ts#queueNextAction so the inbox obeys
// the exact same control primitive: every move becomes a Source-hub task; Tier 1
// runs free and dispatches now, Tier 2/3 open an approval the operator must clear
// before anything reaches the counterparty. The one inbox-specific twist is the
// `channel` hint — dispatch is pinned to the thread's own provider (Slack reply
// vs. email reply, Zoom vs. Google Meet) — and a successful dispatch is recorded
// back onto the thread as an outbound message + any meeting link it produced.
// ---------------------------------------------------------------------------
// The verification standing of a composer artifact an action carries outward.
// Mirrors the columns the trust layer persists on `artifacts` (migrations 0061 /
// 0065). Passed in only when an action is backed by real work product.
type BackingArtifact = { verification_status: string; grounding_score: number };

async function performThreadAction(
  threadId: string,
  action: ActionKind,
  opts: { sharePreface?: string; backingArtifact?: BackingArtifact } = {},
): Promise<ThreadActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const supabase = createServerClient();
  const orgId = auth.ctx.orgId;

  const { data: thread } = await supabase
    .from("inbox_threads")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "Thread not found." };
  const t = thread as InboxThread;

  const mandate = await getActiveMandate(supabase, orgId);
  // Trust layer: when an artifact backs this action, fold its verifiability into
  // the gate so a mandate's Tier-2 auto-approve bypass is revoked for unverified,
  // weakly-grounded output. With no backing artifact this is a plain decision —
  // identical to before.
  const backing = opts.backingArtifact
    ? { verifiable: isVerifiable(opts.backingArtifact) }
    : undefined;
  const decision = gateDecision(action, mandate, backing);
  const agent = AGENT_FOR_INBOX_ACTION[action] ?? "investor_relations";
  const who = t.counterparty_name ?? t.counterparty_email ?? t.subject;
  const title = `${ACTION_LABEL[action] ?? action.replace(/_/g, " ")} — ${who}`;

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      title,
      description: `Unified-inbox action on the ${t.channel} thread "${t.subject}".`,
      hub: "source",
      assigned_agent: agent,
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
    agent,
    hub: "source",
    payload: { title, gate_tier: decision.tier, inbox_thread_id: threadId } as Json,
  });

  // Gated (Tier 2/3): nothing goes out now. Open an approval and stop — the
  // approval-decision path dispatches with the same context once cleared.
  if (decision.requiresApproval) {
    const { data: approval } = await supabase
      .from("approvals")
      .insert({
        organization_id: orgId,
        task_id: task.id,
        requested_by_agent: agent,
        summary: `Tier ${decision.tier} — ${title}`,
      })
      .select("id")
      .single();

    await supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: task.id,
      event_type: "approval.requested",
      agent,
      hub: "source",
      payload: { approval_id: approval?.id, gate_tier: decision.tier, summary: title } as Json,
    });

    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    return {
      ok: true,
      gated: true,
      tier: decision.tier,
      message: `Tier ${decision.tier} — sent to your approvals before it goes out.`,
    };
  }

  // Free to run: dispatch now, pinned to the thread's own channel.
  const result = await dispatchAction({
    orgId,
    actorId: auth.ctx.userId,
    action,
    channel: t.channel,
    target: { name: t.counterparty_name ?? undefined, email: t.counterparty_email ?? undefined },
    // Pre-flight trust guard: an unverifiable backing artifact is refused here
    // before it reaches the counterparty (no-op when none was supplied).
    backingArtifact: opts.backingArtifact,
  });

  await recordDispatch(supabase, {
    orgId,
    actorId: auth.ctx.userId,
    taskId: task.id,
    action,
    result,
  });

  const now = new Date().toISOString();
  const body = opts.sharePreface ? `${opts.sharePreface}\n\n${result.detail}` : result.detail;
  await supabase.from("inbox_messages").insert({
    organization_id: orgId,
    thread_id: threadId,
    direction: "outbound",
    author: "Earn",
    body,
    occurred_at: now,
    metadata: { action, channel: result.channel, reference: result.reference ?? null } as Json,
  });

  // Reflect the outcome back onto the thread: it's been actioned (read), its
  // activity bumps, and any meeting link the booking/video dispatch produced is
  // captured so the thread carries it forward.
  const patch: Partial<InboxThread> = { unread: false, last_message_at: now };
  if (result.reference && (action === "create_video_meeting" || action === "confirm_booking")) {
    patch.meeting_url = result.reference;
    if (action === "confirm_booking" && !t.meeting_at) patch.meeting_at = now;
  }
  await supabase.from("inbox_threads").update(patch).eq("id", threadId);

  await supabase
    .from("tasks")
    .update({
      status: result.ok ? "completed" : "failed",
      progress: 1,
      completed_at: now,
      result: { dispatch: result } as unknown as Json,
    })
    .eq("id", task.id);

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: task.id,
    event_type: "task.completed",
    agent,
    hub: "source",
    payload: { ok: result.ok, channel: result.channel, live: result.live, detail: result.detail } as Json,
  });

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: result.ok, gated: false, tier: decision.tier, message: result.detail, error: result.ok ? undefined : result.error };
}

/** Run a thread's suggested next move (reply / propose / confirm / video). */
export async function actOnThread(formData: FormData): Promise<ThreadActionResult> {
  const threadId = String(formData.get("thread_id") ?? "");
  const action = String(formData.get("action") ?? "") as ActionKind;
  if (!threadId) return { ok: false, error: "Missing thread." };
  if (!THREAD_ACTIONS.includes(action)) return { ok: false, error: "Unsupported action." };
  return performThreadAction(threadId, action);
}

/**
 * Share Command Center details into an outbound reply on the thread — the
 * inbox-to-Command-Center bridge. Pulls the linked deal/investor's headline
 * context into a preface and sends it as a Tier-2 `share_materials` action.
 */
export async function shareCommandCenter(formData: FormData): Promise<ThreadActionResult> {
  const threadId = String(formData.get("thread_id") ?? "");
  if (!threadId) return { ok: false, error: "Missing thread." };

  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: thread } = await supabase
    .from("inbox_threads")
    .select("deal_id, investor_id, subject")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", threadId)
    .maybeSingle();

  let preface = "Sharing the latest from our Command Center.";
  // Trust layer: a Command-Center share carries the deal's latest work product
  // outward, so it is backed by that artifact. We load its verification standing
  // and thread it through the gate + dispatch pre-flight, so an unverified,
  // weakly-grounded artifact can't ride a mandate bypass out to a counterparty.
  let backingArtifact: BackingArtifact | undefined;
  if (thread?.deal_id) {
    const [{ data: deal }, { data: artifact }] = await Promise.all([
      supabase
        .from("deals")
        .select("name, stage, asset_class, target_amount")
        .eq("id", thread.deal_id)
        .maybeSingle(),
      supabase
        .from("artifacts")
        .select("verification_status, grounding_score")
        .eq("deal_id", thread.deal_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (artifact) {
      backingArtifact = {
        verification_status: artifact.verification_status,
        grounding_score: artifact.grounding_score,
      };
    }
    if (deal) {
      const amount = deal.target_amount
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(deal.target_amount)
        : null;
      preface = `Command Center — ${deal.name}: ${[deal.stage, deal.asset_class, amount].filter(Boolean).join(" · ")}.`;
    }
  } else if (thread?.investor_id) {
    const { data: investor } = await supabase
      .from("investors")
      .select("name, investor_type")
      .eq("id", thread.investor_id)
      .maybeSingle();
    if (investor) preface = `Command Center — ${investor.name} (${investor.investor_type}) relationship summary.`;
  }

  return performThreadAction(threadId, "share_materials", { sharePreface: preface, backingArtifact });
}

/** Mark a thread open / snoozed / done, and optionally flip its unread flag. */
export async function setThreadStatus(formData: FormData): Promise<{ ok: boolean }> {
  const threadId = String(formData.get("thread_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const unreadRaw = formData.get("unread");
  if (!threadId || !["open", "snoozed", "done"].includes(status)) return { ok: false };

  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();

  const patch: Partial<InboxThread> = { status: status as InboxThread["status"] };
  if (unreadRaw != null) patch.unread = unreadRaw === "true";
  const { error } = await supabase
    .from("inbox_threads")
    .update(patch)
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", threadId);
  if (error) return { ok: false };

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Bulk-clear the unread flag for all open threads in the org — called when
 *  the operator opens the inbox so already-visible threads don't keep showing
 *  the unread dot or inflating the badge on the next poll. */
export async function markOpenThreadsRead(): Promise<void> {
  const auth = await requireOrgContext();
  if (!auth.ok) return;
  const supabase = createServerClient();
  await supabase
    .from("inbox_threads")
    .update({ unread: false })
    .eq("organization_id", auth.ctx.orgId)
    .eq("unread", true)
    .eq("status", "open")
    .neq("channel", "deal_share");
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Demo data — a one-click realistic inbox so the triage, suggested actions, and
// Command Center digest look alive without wiring live providers. Threads link
// to real seeded deals/investors when present, so the deep links resolve.
// ---------------------------------------------------------------------------
interface DemoThread {
  channel: InboxChannel;
  subject: string;
  counterparty_name: string;
  counterparty_email: string;
  ageHours: number;
  meeting_at?: string | null;
  link?: "deal" | "investor";
  messages: { direction: "inbound" | "outbound"; body: string }[];
}

const DEMO_THREADS: DemoThread[] = [
  {
    channel: "gmail",
    subject: "Re: Fund II — allocation question",
    counterparty_name: "Acme Family Office",
    counterparty_email: "ir@acme.test",
    ageHours: 1,
    link: "investor",
    messages: [
      { direction: "outbound", body: "Attaching the Fund II overview ahead of our committee." },
      { direction: "inbound", body: "Thanks — we're ready to commit. Can you confirm the minimum and the close date? We'd like to wire this week." },
    ],
  },
  {
    channel: "slack",
    subject: "Quick question on Cedar Ridge",
    counterparty_name: "Jordan (Co-investor)",
    counterparty_email: "jordan@coinvest.test",
    ageHours: 4,
    link: "deal",
    messages: [
      { direction: "inbound", body: "Saw the IC memo on Cedar Ridge — what's the entry cap assumption? Want to size our co-invest." },
    ],
  },
  {
    channel: "calendly",
    subject: "Intro call request — placement agent",
    counterparty_name: "Meridian Capital Partners",
    counterparty_email: "deals@meridian.test",
    ageHours: 20,
    messages: [
      { direction: "inbound", body: "We'd like 30 minutes to walk through a healthcare services platform that fits your thesis. Pick a time?" },
    ],
  },
  {
    channel: "google_calendar",
    subject: "Reschedule: diligence sync",
    counterparty_name: "Harbor Point Seller",
    counterparty_email: "cfo@harborpoint.test",
    ageHours: 30,
    meeting_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    link: "deal",
    messages: [
      { direction: "inbound", body: "Can we move Thursday's diligence call to Friday at 2pm ET? Our CFO has a conflict." },
    ],
  },
  {
    channel: "zoom",
    subject: "IC review — record & share",
    counterparty_name: "Investment Committee",
    counterparty_email: "ic@internal.test",
    ageHours: 50,
    messages: [
      { direction: "inbound", body: "Please spin up the room for Thursday's IC and share the link with the partners." },
    ],
  },
  {
    channel: "google_meet",
    subject: "Partner catch-up",
    counterparty_name: "Lateral Partner",
    counterparty_email: "partner@lateral.test",
    ageHours: 90,
    messages: [{ direction: "inbound", body: "Free to catch up early next week? Want to compare pipeline notes." }],
  },
  {
    channel: "docusign",
    subject: "Subscription docs — signature pending",
    counterparty_name: "Northwind LP",
    counterparty_email: "ops@northwind.test",
    ageHours: 12,
    link: "investor",
    messages: [{ direction: "inbound", body: "Sub docs are ready on your side — we'll counter-sign as soon as you execute." }],
  },
];

export async function seedInboxDemo(): Promise<void> {
  const auth = await requireOrgContext();
  if (!auth.ok) return;
  const supabase = createServerClient();
  const orgId = auth.ctx.orgId;

  // Idempotent: clear the org's inbox first so repeated loads don't pile up.
  await supabase.from("inbox_threads").delete().eq("organization_id", orgId);

  const [{ data: investors }, { data: deals }] = await Promise.all([
    supabase.from("investors").select("id").limit(5),
    supabase.from("deals").select("id").limit(5),
  ]);
  const investorIds = (investors ?? []).map((i) => i.id);
  const dealIds = (deals ?? []).map((d) => d.id);

  for (const demo of DEMO_THREADS) {
    const meta = INBOX_CHANNELS[demo.channel];
    const lastMessageAt = new Date(Date.now() - demo.ageHours * 3_600_000).toISOString();
    const { summary, intent } = fallbackSummary({
      subject: demo.subject,
      category: meta.category,
      counterparty: demo.counterparty_name,
      messages: demo.messages,
    });
    const dealId = demo.link === "deal" ? dealIds[0] ?? null : null;
    const investorId = demo.link === "investor" ? investorIds[0] ?? null : null;
    const priority = computePriority({
      category: meta.category,
      unread: true,
      hasContext: Boolean(dealId || investorId),
      ageHours: demo.ageHours,
      intent: `${intent} ${demo.messages.map((m) => m.body).join(" ")}`,
    });

    const { data: thread } = await supabase
      .from("inbox_threads")
      .insert({
        organization_id: orgId,
        channel: demo.channel,
        category: meta.category,
        subject: demo.subject,
        counterparty_name: demo.counterparty_name,
        counterparty_email: demo.counterparty_email,
        preview: demo.messages[demo.messages.length - 1]?.body.slice(0, 140) ?? null,
        status: "open",
        unread: true,
        priority,
        intent,
        ai_summary: summary,
        last_message_at: lastMessageAt,
        meeting_at: demo.meeting_at ?? null,
        deal_id: dealId,
        investor_id: investorId,
        created_by: auth.ctx.userId,
      })
      .select("id")
      .single();
    if (!thread) continue;

    const baseTime = Date.now() - demo.ageHours * 3_600_000;
    await supabase.from("inbox_messages").insert(
      demo.messages.map((m, idx) => ({
        organization_id: orgId,
        thread_id: thread.id,
        direction: m.direction,
        author: m.direction === "inbound" ? demo.counterparty_name : "You",
        body: m.body,
        occurred_at: new Date(baseTime + idx * 60_000).toISOString(),
      })),
    );
  }

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

// Inbox-originated tasks are always created with hub="source" (see performThreadAction
// above). The hub filter is intentional: it ensures a dismiss can never cancel a task
// that arrived from a different hub (e.g. "execute", "build"), even if its UUID were
// somehow surfaced in the inbox UI.
export async function dismissApprovalTask(taskId: string): Promise<{ ok: boolean }> {
  if (!taskId) return { ok: false };
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", taskId)
    .eq("hub", "source")
    .eq("status", "awaiting_approval")
    .select("id");
  if (error) { console.error("[dismissApprovalTask]", error.message); return { ok: false }; }
  if (!data?.length) return { ok: false };
  const { error: approvalErr } = await supabase.from("approvals")
    .update({ decision: "rejected" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("task_id", taskId);
  if (approvalErr) {
    console.error("[dismissApprovalTask] approvals", approvalErr.message);
    // Roll back the task cancellation so DB stays consistent
    await supabase.from("tasks").update({ status: "awaiting_approval" })
      .eq("organization_id", auth.ctx.orgId).eq("id", taskId);
    return { ok: false };
  }
  // Also cancel any subtasks so their approvals don't dangle
  const { data: subtasks } = await supabase
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("parent_task_id", taskId)
    .eq("status", "awaiting_approval")
    .select("id");
  if (subtasks?.length) {
    const subtaskIds = subtasks.map((r) => r.id);
    const { error: subtaskApprovalErr } = await supabase.from("approvals")
      .update({ decision: "rejected" })
      .eq("organization_id", auth.ctx.orgId)
      .in("task_id", subtaskIds);
    if (subtaskApprovalErr) {
      console.error("[dismissApprovalTask] subtask approvals", subtaskApprovalErr.message);
      // Roll back subtask cancellations to stay consistent.
      // Known edge case: the parent task and its approvals are already committed as
      // cancelled/rejected at this point (no DB transaction). Subtasks revert to
      // awaiting_approval but their parent is cancelled — they become orphaned inbox
      // items until a future reconciliation sweep. Acceptable given the low probability;
      // a proper fix requires an RPC/transaction or ON DELETE CASCADE on parent_task_id.
      await supabase.from("tasks").update({ status: "awaiting_approval" })
        .eq("organization_id", auth.ctx.orgId).in("id", subtaskIds);
    } else {
      const { error: subtaskEventErr } = await supabase.from("task_events").insert(
        subtaskIds.map((task_id) => ({
          organization_id: auth.ctx.orgId,
          task_id,
          event_type: "task.cancelled",
          agent: null,
          hub: "source",
          payload: { reason: "dismissed_from_inbox", parent_task_id: taskId } as Json,
        })),
      );
      if (subtaskEventErr) console.error("[dismissApprovalTask] subtask task_events", subtaskEventErr.message);
    }
  }
  const { error: eventErr } = await supabase.from("task_events").insert({
    organization_id: auth.ctx.orgId,
    task_id: taskId,
    event_type: "task.cancelled",
    agent: null,
    hub: "source",
    payload: { reason: "dismissed_from_inbox" } as Json,
  });
  if (eventErr) console.error("[dismissApprovalTask] task_events", eventErr.message);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true };
}

// taskIds must be the exact IDs currently rendered in the UI — caller-supplied
// so we never cancel tasks outside the visible inbox set.
export async function dismissAllApprovalTasks(taskIds: string[]): Promise<{ ok: boolean }> {
  if (!taskIds.length) return { ok: false };
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("hub", "source")
    .eq("status", "awaiting_approval")
    .in("id", taskIds)
    .select("id");
  if (error) { console.error("[dismissAllApprovalTasks]", error.message); return { ok: false }; }
  if (!data?.length) return { ok: false };
  const cancelledIds = data.map((r) => r.id);
  const { error: approvalErr } = await supabase.from("approvals")
    .update({ decision: "rejected" })
    .eq("organization_id", auth.ctx.orgId)
    .in("task_id", cancelledIds);
  if (approvalErr) {
    console.error("[dismissAllApprovalTasks] approvals", approvalErr.message);
    // Roll back task cancellations so DB stays consistent
    await supabase.from("tasks").update({ status: "awaiting_approval" })
      .eq("organization_id", auth.ctx.orgId).in("id", cancelledIds);
    return { ok: false };
  }
  // Cascade to subtasks
  const { data: subtasks } = await supabase
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("organization_id", auth.ctx.orgId)
    .in("parent_task_id", cancelledIds)
    .eq("status", "awaiting_approval")
    .select("id, parent_task_id");
  if (subtasks?.length) {
    const subtaskIds = subtasks.map((r) => r.id);
    const { error: subtaskApprovalErr } = await supabase.from("approvals")
      .update({ decision: "rejected" })
      .eq("organization_id", auth.ctx.orgId)
      .in("task_id", subtaskIds);
    if (subtaskApprovalErr) {
      console.error("[dismissAllApprovalTasks] subtask approvals", subtaskApprovalErr.message);
      // Same known orphan edge case as dismissApprovalTask: parent tasks are already
      // committed as cancelled at this point — subtasks revert but their parents stay
      // cancelled. Acceptable until a transaction-based RPC replaces these calls.
      await supabase.from("tasks").update({ status: "awaiting_approval" })
        .eq("organization_id", auth.ctx.orgId).in("id", subtaskIds);
    } else {
      const parentById = new Map(subtasks.map((r) => [r.id, r.parent_task_id ?? null]));
      const { error: subtaskEventErr } = await supabase.from("task_events").insert(
        subtaskIds.map((task_id) => ({
          organization_id: auth.ctx.orgId,
          task_id,
          event_type: "task.cancelled",
          agent: null,
          hub: "source",
          payload: { reason: "dismissed_from_inbox", parent_task_id: parentById.get(task_id) } as Json,
        })),
      );
      if (subtaskEventErr) console.error("[dismissAllApprovalTasks] subtask task_events", subtaskEventErr.message);
    }
  }
  const { error: eventErr } = await supabase.from("task_events").insert(
    cancelledIds.map((task_id) => ({
      organization_id: auth.ctx.orgId,
      task_id,
      event_type: "task.cancelled",
      agent: null,
      hub: "source",
      payload: { reason: "dismissed_from_inbox" } as Json,
    })),
  );
  if (eventErr) console.error("[dismissAllApprovalTasks] task_events", eventErr.message);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteThreadAction(threadId: string): Promise<{ ok: boolean }> {
  if (!threadId) return { ok: false };
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("inbox_threads")
    .delete()
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", threadId)
    .select("id");
  if (error) { console.error("[deleteThreadAction]", error.message); return { ok: false }; }
  if (!data?.length) return { ok: false };
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function clearInbox(opts?: { category?: InboxCategory }): Promise<{ ok: boolean }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();
  // Only wipe open threads — snoozed/done are deliberately parked and must survive.
  const base = supabase
    .from("inbox_threads")
    .delete()
    .eq("organization_id", auth.ctx.orgId)
    .eq("status", "open");
  const { error } = await (opts?.category ? base.eq("category", opts.category) : base);
  if (error) { console.error("[clearInbox]", error.message); return { ok: false }; }
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true };
}
