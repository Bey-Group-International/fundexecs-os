// lib/inbox/deliver-reply.server.ts
// Putting an inbox reply into somebody's inbox.
//
// Two paths reach here: a reply sent immediately from the inbox (or from a
// meeting report, which sends through the inbox), and a reply that waited for
// approval and has just been approved. Both used to fail an invitee in ways
// nobody was told about:
//
//   - the reply went out with the subject "(no subject)", because nothing ever
//     passed the thread's subject to the mail adapter — so the invitee saw a
//     blank subject and their answer came back as "Re: (no subject)", a thread
//     the meeting could not recognise;
//   - it went out only through the ORGANIZATION's mailbox. A host who had
//     connected their own Gmail (enough for the meeting follow-up) got a saved
//     draft instead, reported back as success;
//   - and an APPROVED reply was never sent at all: approving ran the generic
//     workflow engine, which found no steps and marked the task complete.
//
// Email replies now go from the composer's own mailbox, falling back to the
// org's (mailboxFor — the same rule as the follow-up), under "Re: <subject>",
// and are refused with the reason when no mailbox exists, never saved as a
// draft and counted as sent. A Gmail thread sent from a member's own mailbox
// is tracked so the answers are read back. Non-email channels keep the adapter
// dispatch they always had.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboxThread, Json } from "@/lib/supabase/database.types";
import { sendEmail, escapeHtml } from "@/lib/email";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { dispatchAction } from "@/lib/integrations";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import { recordDispatch } from "@/lib/integrations/log";
import type { DispatchContext, DispatchResult } from "@/lib/integrations/types";
import type { ActionKind } from "@/lib/gates";
import { isVerifiable } from "@/lib/grounding";
import type { AgentKey } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Where the inbox send would go, recorded on a gated task so approval can send it. */
export interface PendingInboxReply {
  threadId: string;
  action: ActionKind;
  body: string | null;
  /** Who composed it: their mailbox sends it, not the approver's. */
  senderId: string;
  /** Set once delivered; the meeting's follow-up status reads it. */
  delivered?: boolean;
  error?: string;
}

/** The pending reply on a task's result, if this task is one. */
export function extractInboxReply(result: unknown): PendingInboxReply | null {
  if (!result || typeof result !== "object") return null;
  const r = (result as { inboxReply?: unknown }).inboxReply;
  if (!r || typeof r !== "object") return null;
  const p = r as Partial<PendingInboxReply>;
  if (typeof p.threadId !== "string" || typeof p.senderId !== "string" || typeof p.action !== "string") return null;
  return {
    threadId: p.threadId,
    action: p.action as ActionKind,
    body: typeof p.body === "string" ? p.body : null,
    senderId: p.senderId,
    delivered: p.delivered === true,
  };
}

const LEGACY_PREFIX = "Unified-inbox reply on the ";

/**
 * A reply queued before replies were parked on the task (inboxReply), rebuilt
 * from what that version did record: the composed text in the task description
 * and the thread on its task.created event. Without this, everything already
 * waiting in approvals when the fix shipped would still approve into nothing.
 */
export async function legacyInboxReply(
  client: Client,
  task: { id: string; description?: string | null; created_by?: string | null },
): Promise<PendingInboxReply | null> {
  const desc = task.description ?? "";
  if (!desc.startsWith(LEGACY_PREFIX) || !task.created_by) return null;
  const at = desc.indexOf('":\n\n');
  if (at < 0) return null;
  const body = desc.slice(at + 4).trim();
  if (!body) return null;
  const { data } = await client
    .from("task_events")
    .select("payload")
    .eq("task_id", task.id)
    .eq("event_type", "task.created")
    .limit(1)
    .maybeSingle();
  const threadId = (data as { payload?: { inbox_thread_id?: unknown } } | null)?.payload?.inbox_thread_id;
  if (typeof threadId !== "string" || !threadId) return null;
  return { threadId, action: "send_reply", body, senderId: task.created_by };
}

/** An email thread: a reply to it is an email to its counterparty. */
export function isEmailThread(t: Pick<InboxThread, "channel" | "counterparty_email">): boolean {
  return t.channel === "gmail" && Boolean(t.counterparty_email);
}

/** "Re: <subject>", once — never "Re: Re:", never "(no subject)" when there is one. */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "(no subject)";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

export function replyHtml(body: string): string {
  const escaped = escapeHtml(body);
  return escaped ? `<p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` : "";
}

/** A client that can read another member's mailbox grant and write the tracking table. */
function privileged(fallback: Client): Client {
  return hasSupabaseServiceEnv() ? (createServiceClient() as unknown as Client) : fallback;
}

export type MailboxCheck = { ok: true } | { ok: false; error: string; needsMailbox: true };

/**
 * Whether this sender can send email at all, before anything is queued — so a
 * reply nobody could ever send is refused while its author is still looking at
 * it, rather than approved later into nothing.
 */
export async function checkSendingMailbox(client: Client, senderId: string, orgId: string): Promise<MailboxCheck> {
  const mailbox = await mailboxFor(privileged(client), senderId, orgId);
  if (mailbox.ok) return { ok: true };
  return { ok: false, needsMailbox: true, error: mailboxProblemMessage(mailbox.problem) };
}

export interface DeliverInput {
  orgId: string;
  /** Whose mailbox sends it. */
  senderId: string;
  thread: InboxThread;
  action: ActionKind;
  body?: string;
  /** Composer work product behind the action, for the dispatch trust gate. */
  backingArtifact?: DispatchContext["backingArtifact"];
}

export type DeliverResult = DispatchResult & { needsMailbox?: boolean };

/** Send it. Email threads from the sender's mailbox; everything else through its adapter. */
export async function deliverThreadAction(client: Client, input: DeliverInput): Promise<DeliverResult> {
  const t = input.thread;
  if (input.action === "send_reply" && isEmailThread(t) && input.body) {
    // The same trust gate dispatchAction applies: unverified work product does not leave.
    if (input.backingArtifact && !isVerifiable(input.backingArtifact)) {
      return {
        ok: false,
        channel: "gmail",
        live: false,
        gated: true,
        detail:
          "Blocked at the trust gate: unverified, weakly-grounded work product cannot be sent to a counterparty. Verify it first.",
      };
    }
    const admin = privileged(client);
    const mailbox = await mailboxFor(admin, input.senderId, input.orgId);
    if (!mailbox.ok) {
      const message = mailboxProblemMessage(mailbox.problem);
      return { ok: false, channel: "gmail", live: false, detail: message, error: message, needsMailbox: true };
    }
    const to = t.counterparty_email as string;
    const sent = await sendEmail({
      orgId: input.orgId,
      credentials: { gmailAccessToken: mailbox.token },
      to: { name: t.counterparty_name ?? to, email: to },
      subject: replySubject(t.subject),
      htmlBody: replyHtml(input.body),
    });
    if (!sent.ok) {
      return {
        ok: false,
        channel: "gmail",
        live: true,
        detail: `Email to ${to} could not be delivered. ${sent.detail}`,
        error: sent.detail,
      };
    }
    // A member's own mailbox is not swept; tracking this Gmail thread is what
    // brings the answer back into the inbox. The org mailbox is swept already.
    if (mailbox.source === "member" && sent.gmailThreadId) {
      const { error } = await admin.from("tracked_mail_threads").upsert(
        {
          organization_id: input.orgId,
          user_id: input.senderId,
          gmail_thread_id: sent.gmailThreadId,
          inbox_thread_id: t.id,
          meeting_id: t.meeting_id ?? null,
          mailbox_email: mailbox.email,
        },
        { onConflict: "user_id,gmail_thread_id" },
      );
      if (error) console.warn("[deliver-reply] tracking failed", error.message);
    }
    return {
      ok: true,
      channel: "gmail",
      live: true,
      detail: `Email sent to ${t.counterparty_name ?? to}.`,
      reference: sent.gmailMessageId,
    };
  }

  const connected = await orgConnectedChannels(client, input.orgId);
  return dispatchAction({
    orgId: input.orgId,
    actorId: input.senderId,
    action: input.action,
    channel: t.channel,
    connected: connected.has(t.channel),
    target: { name: t.counterparty_name ?? undefined, email: t.counterparty_email ?? undefined },
    subject: input.action === "send_reply" ? replySubject(t.subject) : undefined,
    body: input.body,
    backingArtifact: input.backingArtifact,
  });
}

/**
 * Deliver a reply that waited for approval and has just been approved, and
 * record what happened on the thread and the task exactly as an immediate send
 * would. Never throws; the outcome is on the task.
 */
export async function deliverApprovedReply(
  client: Client,
  input: { orgId: string; approverId: string; taskId: string; agent: AgentKey | null; hub: string | null; reply: PendingInboxReply },
): Promise<{ ok: boolean; error?: string }> {
  const { reply } = input;
  const now = () => new Date().toISOString();
  const finish = async (ok: boolean, patch: Record<string, unknown>, error?: string) => {
    await client
      .from("tasks")
      .update({
        status: ok ? "completed" : "failed",
        progress: 1,
        completed_at: now(),
        result: { inboxReply: { ...reply, delivered: ok, error }, ...patch } as unknown as Json,
      })
      .eq("organization_id", input.orgId)
      .eq("id", input.taskId);
    await client.from("task_events").insert({
      organization_id: input.orgId,
      task_id: input.taskId,
      event_type: "task.completed",
      agent: input.agent,
      hub: input.hub,
      payload: { ok, approved: true, error: error ?? null } as Json,
    } as never);
    return { ok, error };
  };

  const { data: thread } = await client
    .from("inbox_threads")
    .select("*")
    .eq("organization_id", input.orgId)
    .eq("id", reply.threadId)
    .maybeSingle();
  if (!thread) return finish(false, {}, "The conversation no longer exists.");
  const t = thread as InboxThread;

  let result: DeliverResult;
  try {
    result = await deliverThreadAction(client, {
      orgId: input.orgId,
      senderId: reply.senderId,
      thread: t,
      action: reply.action,
      body: reply.body ?? undefined,
    });
  } catch (err) {
    return finish(false, {}, err instanceof Error ? err.message : "Delivery failed.");
  }

  await recordDispatch(client, {
    orgId: input.orgId,
    actorId: input.approverId,
    taskId: input.taskId,
    action: reply.action,
    result,
  });

  if (!result.ok) return finish(false, { dispatch: result }, result.error ?? result.detail);

  const at = now();
  await client.from("inbox_messages").insert({
    organization_id: input.orgId,
    thread_id: t.id,
    direction: "outbound",
    author: "Earn",
    body: reply.body ?? result.detail,
    occurred_at: at,
    metadata: {
      action: reply.action,
      channel: result.channel,
      reference: result.reference ?? null,
      dispatch_detail: result.detail,
      approved: true,
    } as Json,
  });
  await client
    .from("inbox_threads")
    .update({ unread: false, last_message_at: at })
    .eq("organization_id", input.orgId)
    .eq("id", t.id);
  return finish(true, { dispatch: result });
}
